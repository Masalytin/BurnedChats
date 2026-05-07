import { useCallback, useEffect, useRef, useState } from 'react';

import type { Cell } from '@ton/core';

import { useTonConnect } from '@/hooks/useTonConnect';
import {
  createProposal as createProposalTx,
  getActiveProposals,
  getUserVote,
  getUserVotingPower,
  vote as voteTx,
  type GovernanceDeps,
} from '@/ton/governance';
import type { TxResult } from '@/ton/types';
import type { ProposalType, ProposalSummary, UserVote } from '@/types/ton';

/** Polling interval for active proposals (task card P5-5-3-1). */
export const GOVERNANCE_POLL_MS = 60_000;

export interface UseGovernance {
  proposals: ProposalSummary[];
  userVotes: Map<number, UserVote>;
  votingPower: bigint;
  isLoading: boolean;
  error: Error | null;
  refetch(): Promise<void>;
  vote(params: { proposalId: number; support: boolean }): Promise<TxResult>;
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
  const [error, setError] = useState<Error | null>(null);

  const depsRef = useRef(deps);
  depsRef.current = deps;

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const d = depsRef.current;
      const list = await getActiveProposals(d);
      setProposals(list);
      const addr = walletAddress?.trim();
      if (isConnected && addr) {
        const vp = await getUserVotingPower(addr, d);
        setVotingPower(vp);
        const entries = await Promise.all(
          list.map(async (p) => {
            const v = await getUserVote(p.id, addr, d);
            return [p.id, v] as const;
          }),
        );
        const m = new Map<number, UserVote>();
        for (const [id, v] of entries) {
          if (v !== null) {
            m.set(id, v);
          }
        }
        setUserVotes(m);
      } else {
        setVotingPower(0n);
        setUserVotes(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
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
    async (params: { proposalId: number; support: boolean }): Promise<TxResult> => {
      const addr = walletAddress?.trim();
      if (!addr) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet to vote.' };
      }
      const optimistic: UserVote = {
        proposalId: params.proposalId,
        support: params.support,
        vp: votingPower,
        voteTimestamp: Math.floor(Date.now() / 1000),
      };
      setUserVotes((prev) => {
        const next = new Map(prev);
        next.set(params.proposalId, optimistic);
        return next;
      });
      const result = await voteTx({ ...params, walletAddress: addr }, depsRef.current);
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
    [walletAddress, votingPower, load],
  );

  const createProposal = useCallback(
    async (params: { type: ProposalType; payload: Cell; period?: number }): Promise<TxResult> => {
      void params.period;
      const addr = walletAddress?.trim();
      if (!addr) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet to create a proposal.' };
      }
      return createProposalTx({ type: params.type, payload: params.payload, walletAddress: addr }, depsRef.current);
    },
    [walletAddress],
  );

  return {
    proposals,
    userVotes,
    votingPower,
    isLoading,
    error,
    refetch,
    vote,
    createProposal,
  };
}
