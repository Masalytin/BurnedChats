/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';

import { describeLockGatedVoteUx } from '@/components/Governance/governanceUi';

describe('describeLockGatedVoteUx', () => {
  it('flags Flexible-only stake when live VP > 0 but lock-gated VP is 0', () => {
    const ux = describeLockGatedVoteUx({ liveVp: 1_000_000_000n, lockGatedVp: 0n });
    expect(ux.kind).toBe('flexible-only');
    expect(ux.displayVp).toBe(0n);
    expect(ux.showFlexibleHint).toBe(true);
  });

  it('uses lock-gated VP as the displayed vote weight when it is positive', () => {
    const ux = describeLockGatedVoteUx({ liveVp: 5_000_000_000n, lockGatedVp: 3_000_000_000n });
    expect(ux.kind).toBe('eligible');
    expect(ux.displayVp).toBe(3_000_000_000n);
    expect(ux.showFlexibleHint).toBe(false);
  });

  it('treats zero live VP as no stake (no Flexible-specific hint)', () => {
    const ux = describeLockGatedVoteUx({ liveVp: 0n, lockGatedVp: 0n });
    expect(ux.kind).toBe('no-stake');
    expect(ux.displayVp).toBe(0n);
    expect(ux.showFlexibleHint).toBe(false);
  });
});
