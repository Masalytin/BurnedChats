import { Address, Cell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { buildCancelProposalMsg } from '@/ton/transactionBuilder';

describe('buildCancelProposalMsg', () => {
  it('encodes ProposalCancel opcode 0x5a040014', () => {
    const proposal = Address.parse(`0:${'aa'.repeat(32)}`);
    const msg = buildCancelProposalMsg({ proposalAddress: proposal });
    const op = Cell.fromBase64(msg.payload).beginParse().loadUint(32);
    expect(op).toBe(0x5a040014);
    expect(msg.address).toBe(proposal.toString());
  });
});
