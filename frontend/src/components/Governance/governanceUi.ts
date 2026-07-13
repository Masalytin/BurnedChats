import type { TFunction } from 'i18next';
import { Address } from '@ton/core';

import type { ProposalSummary } from '@/types/ton';

const SEC_PER_DAY = 86_400;

/** Minimum VP to create a proposal: ceil(1% of total VP). */
/** @deprecated Use on-chain {@link getMinProposalVp} for create gates; informational only. */
export function minimumProposalVp(totalVp: bigint): bigint {
  if (totalVp <= 0n) {
    return 0n;
  }
  return (totalVp + 99n) / 100n;
}

/**
 * Compare live `get_voting_power` vs lock-gated `get_voting_power_locked_beyond`
 * for vote UX (IMP-FAUDIT-F09). Flexible-only stakes have live VP but 0 lock-gated VP.
 */
export type LockGatedVoteUx = {
  kind: 'flexible-only' | 'eligible' | 'no-stake';
  /** VP that will actually count for CastVote under the lock-gate. */
  displayVp: bigint;
  showFlexibleHint: boolean;
};

export function describeLockGatedVoteUx(params: {
  liveVp: bigint;
  lockGatedVp: bigint;
}): LockGatedVoteUx {
  const live = params.liveVp < 0n ? 0n : params.liveVp;
  const gated = params.lockGatedVp < 0n ? 0n : params.lockGatedVp;
  if (live <= 0n) {
    return { kind: 'no-stake', displayVp: 0n, showFlexibleHint: false };
  }
  if (gated <= 0n) {
    return { kind: 'flexible-only', displayVp: 0n, showFlexibleHint: true };
  }
  return { kind: 'eligible', displayVp: gated, showFlexibleHint: false };
}

export function truncateMiddle(addr: string, head = 6, tail = 4): string {
  const s = addr.trim();
  if (s.length <= head + tail + 1) {
    return s;
  }
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function addressesLikelyEqual(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) {
    return false;
  }
  try {
    return Address.parse(x).equals(Address.parse(y));
  } catch {
    return x.toLowerCase() === y.toLowerCase();
  }
}

export function formatEndsInRemaining(sec: number, t: TFunction, nowSec = Math.floor(Date.now() / 1000)): string {
  if (sec <= nowSec) {
    return t('governance.ended');
  }
  return t('governance.endsIn', { parts: formatTimePartsRemaining(sec, nowSec, t) });
}

function formatTimePartsRemaining(targetSec: number, nowSec: number, t: TFunction): string {
  let remaining = targetSec - nowSec;
  const days = Math.floor(remaining / SEC_PER_DAY);
  remaining -= days * SEC_PER_DAY;
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const mins = Math.floor(remaining / 60);

  const parts: string[] = [];
  if (days > 0) {
    parts.push(t('governance.timePartDay', { count: days }));
  }
  if (hours > 0) {
    parts.push(t('governance.timePartHour', { count: hours }));
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(t('governance.timePartMinute', { count: Math.max(1, mins) }));
  }

  return parts.join('\u00a0');
}

export function formatStartsInRemaining(
  startSec: number,
  t: TFunction,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  if (startSec <= nowSec) {
    return '';
  }
  return t('governance.voteOpensIn', { parts: formatTimePartsRemaining(startSec, nowSec, t) });
}

export function mergeProposalsUnique(primary: ProposalSummary[], secondary: ProposalSummary[]): ProposalSummary[] {
  const m = new Map<number, ProposalSummary>();
  for (const p of primary) {
    m.set(p.id, p);
  }
  for (const p of secondary) {
    if (!m.has(p.id)) {
      m.set(p.id, p);
    }
  }
  return [...m.values()];
}

export type FilterTab = 'active' | 'recent' | 'my-votes' | 'my-proposals';

export type SortMode = 'newest' | 'most-voted' | 'ending-soon';

export function filterProposalsForTab(
  tab: FilterTab,
  activeRows: ProposalSummary[],
  recentRows: ProposalSummary[],
  wallet: string | null,
  votedIds: Set<number>,
): ProposalSummary[] {
  const merged = mergeProposalsUnique(activeRows, recentRows);
  switch (tab) {
    case 'active':
      return activeRows.filter((p) => p.state === 0);
    case 'recent':
      return recentRows;
    case 'my-votes':
      return merged.filter((p) => votedIds.has(p.id));
    case 'my-proposals': {
      if (!wallet?.trim()) {
        return [];
      }
      return merged.filter((p) => addressesLikelyEqual(p.proposer, wallet));
    }
    default:
      return merged;
  }
}

export function sortProposals(mode: SortMode, rows: ProposalSummary[], nowSec: number): ProposalSummary[] {
  const copy = [...rows];
  switch (mode) {
    case 'newest':
      return copy.sort((a, b) => b.startTime - a.startTime);
    case 'most-voted':
      return copy.sort((a, b) => {
        const ta = a.forVotes + a.againstVotes;
        const tb = b.forVotes + b.againstVotes;
        if (ta === tb) {
          return b.id - a.id;
        }
        return tb > ta ? 1 : tb < ta ? -1 : 0;
      });
    case 'ending-soon':
      return copy.sort((a, b) => {
        const da = a.state === 0 ? Math.max(0, a.endTime - nowSec) : Number.MAX_SAFE_INTEGER;
        const db = b.state === 0 ? Math.max(0, b.endTime - nowSec) : Number.MAX_SAFE_INTEGER;
        if (da === db) {
          return b.startTime - a.startTime;
        }
        return da - db;
      });
    default:
      return copy;
  }
}
