import { useCallback, useEffect, useRef, useState } from 'react';

import type { Cell } from '@ton/core';

import i18n from '@/i18n';
import { useTonConnect } from '@/hooks/useTonConnect';
import {
  createProposal as createProposalTx,
  executeProposal as executeProposalTx,
  getActiveProposals,
  getUserVote,
  getUserVotingPower,
  queueProposal as queueProposalTx,
  vote as voteTx,
  type GovernanceDeps,
} from '@/ton/governance';
import { getVoteEffectiveVp } from '@/ton/governance-vp';
import type { TxResult } from '@/ton/types';
import type { ProposalType, ProposalSummary, UserVote } from '@/types/ton';

/** Polling interval for active proposals (task card P5-5-3-1). */
export const GOVERNANCE_POLL_MS = 60_000;

export interface UseGovernance {
  proposals: ProposalSummary[];
  userVotes: Map<number, UserVote>;
  votingPower: bigint;
  isLoading: boolean;
  /** False until the first {@link load} cycle completes (success or error). */
  hasLoadedOnce: boolean;
  error: Error | null;
  refetch(): Promise<void>;
  vote(params: { proposalId: number; support: boolean; endTimeSec: number }): Promise<TxResult>;
  queue(params: { proposalId: number }): Promise<TxResult>;
  execute(params: { proposalId: number; proposalType: ProposalType }): Promise<TxResult>;
  createProposal(params: { type: ProposalType; payload: Cell; period?: number }): Promise<TxResult>;
}

/**
 * Governance read model + Ton Connect writes. Polls {@link getActiveProposals} every {@link GOVERNANCE_POLL_MS};
 * interval cleared on unmount.
 */
export function useGovernance(deps?: GovernanceDeps): UseGovernance {
  const { walletAddress, isConnected } = useTonConnect();
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [userVotes, setUserVotes] = useState<Map<number, UserVote>>(() => new Map());
  const [votingPower, setVotingPower] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const loadGenRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const gen = ++loadGenRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const d = depsRef.current;
      const list = await getActiveProposals(d);
      if (gen !== loadGenRef.current) {
        return;
      }
      setProposals(list);
      const addr = walletAddress?.trim();
      if (isConnected && addr) {
        const vp = await getUserVotingPower(addr, d);
        if (gen !== loadGenRef.current) {
          return;
        }
        setVotingPower(vp);
        const entries = await Promise.allSettled(
          list.map(async (p) => {
            const v = await getUserVote(p.id, addr, d);
            return [p.id, v] as const;
          }),
        );
        if (gen !== loadGenRef.current) {
          return;
        }
        const m = new Map<number, UserVote>();
        for (const entry of entries) {
          if (entry.status === 'fulfilled' && entry.value[1] !== null) {
            m.set(entry.value[0], entry.value[1]);
          }
        }
        setUserVotes(m);
      } else {
        setVotingPower(0n);
        setUserVotes(new Map());
      }
    } catch (e) {
      if (gen === loadGenRef.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      if (gen === loadGenRef.current) {
        setIsLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [isConnected, walletAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void load();
    }, GOVERNANCE_POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [load]);

  const refetch = useCallback(async (): Promise<void> => {
    await load();
  }, [load]);

  const vote = useCallback(
    async (params: { proposalId: number; support: boolean; endTimeSec: number }): Promise<TxResult> => {
      const addr = walletAddress?.trim();
      if (!addr) {
        return {
          ok: false,
          kind: 'unknown',
          code: 'governance.error.connectWalletVote',
          message: i18n.t('governance.error.connectWalletVote'),
        };
      }
      const endTimeSec = params.endTimeSec;
      if (!Number.isFinite(endTimeSec) || endTimeSec <= 0) {
        return {
          ok: false,
          kind: 'unknown',
          code: 'governance.error.voteEndTimeRequired',
          message: i18n.t('governance.error.voteEndTimeRequired'),
        };
      }
      let gatedVp = 0n;
      try {
        gatedVp = await getVoteEffectiveVp(addr, endTimeSec, depsRef.current);
      } catch {
        gatedVp = 0n;
      }
      const optimistic: UserVote = {
        proposalId: params.proposalId,
        support: params.support,
        vp: gatedVp,
        voteTimestamp: Math.floor(Date.now() / 1000),
      };
      setUserVotes((prev) => {
        const next = new Map(prev);
        next.set(params.proposalId, optimistic);
        return next;
      });
      const result = await voteTx(
        { ...params, walletAddress: addr, endTimeSec },
        depsRef.current,
      );
      if (result.ok) {
        await load();
      } else {
        setUserVotes((prev) => {
          const next = new Map(prev);
          next.delete(params.proposalId);
          return next;
        });
      }
      return result;
    },
    [walletAddress, load],
  );

  const queue = useCallback(
    async (params: { proposalId: number }): Promise<TxResult> => {
      const addr = walletAddress?.trim();
      if (!addr) {
        return {
          ok: false,
          kind: 'unknown',
          code: 'governance.error.connectWalletQueue',
          message: i18n.t('governance.error.connectWalletQueue'),
        };
      }
      const result = await queueProposalTx({ proposalId: params.proposalId, walletAddress: addr }, depsRef.current);
      if (result.ok) {
        await load();
      }
      return result;
    },
    [walletAddress, load],
  );

  const execute = useCallback(
    async (params: { proposalId: number; proposalType: ProposalType }): Promise<TxResult> => {
      const addr = walletAddress?.trim();
      if (!addr) {
        return {
          ok: false,
          kind: 'unknown',
          code: 'governance.error.connectWalletExecute',
          message: i18n.t('governance.error.connectWalletExecute'),
        };
      }
      const result = await executeProposalTx(
        { proposalId: params.proposalId, proposalType: params.proposalType, walletAddress: addr },
        depsRef.current,
      );
      if (result.ok) {
        await load();
      }
      return result;
    },
    [walletAddress, load],
  );

  const createProposal = useCallback(
    async (params: { type: ProposalType; payload: Cell; period?: number }): Promise<TxResult> => {
      void params.period;
      const addr = walletAddress?.trim();
      if (!addr) {
        return {
          ok: false,
          kind: 'unknown',
          code: 'governance.error.connectWalletCreate',
          message: i18n.t('governance.error.connectWalletCreate'),
        };
      }
      const result = await createProposalTx(
        { type: params.type, payload: params.payload, walletAddress: addr },
        depsRef.current,
      );
      if (result.ok) {
        await load();
      }
      return result;
    },
    [walletAddress, load],
  );

  return {
    proposals,
    userVotes,
    votingPower,
    isLoading,
    hasLoadedOnce,
    error,
    refetch,
    vote,
    queue,
    execute,
    createProposal,
  };
}
