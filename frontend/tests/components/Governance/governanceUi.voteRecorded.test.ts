import { describe, expect, it } from 'vitest';

import { isOnChainVoteRecorded } from '@/components/Governance/governanceUi';
import type { UserVote } from '@/types/ton';

const baseVote: UserVote = {
  proposalId: 7,
  support: null,
  vp: 1_000_000_000n,
  voteTimestamp: 0,
};

describe('isOnChainVoteRecorded', () => {
  it('returns false when vote is null', () => {
    expect(isOnChainVoteRecorded(null, true)).toBe(false);
  });

  it('returns true when chain reports voted but support is unknown (has_voted only)', () => {
    expect(isOnChainVoteRecorded(baseVote, true)).toBe(true);
    expect(isOnChainVoteRecorded(baseVote, false)).toBe(true);
  });

  it('returns true when support matches', () => {
    expect(isOnChainVoteRecorded({ ...baseVote, support: true }, true)).toBe(true);
    expect(isOnChainVoteRecorded({ ...baseVote, support: false }, false)).toBe(true);
  });

  it('returns false when support is known and mismatches', () => {
    expect(isOnChainVoteRecorded({ ...baseVote, support: true }, false)).toBe(false);
    expect(isOnChainVoteRecorded({ ...baseVote, support: false }, true)).toBe(false);
  });
});
