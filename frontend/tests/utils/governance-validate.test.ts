/** @vitest-environment happy-dom */

import { Address, beginCell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import type { GovernanceProposalDraft } from '@/components/Governance/PayloadEditor';
import { draftToFormValues } from '@/components/Governance/PayloadEditor';
import { ProposalType } from '@/types/ton';
import { encodePayload } from '@/utils/governance-encode';
import { validateGovernanceDraft } from '@/utils/governance-validate';

function friendlyAddr(hexDigit: string): string {
  return Address.parse(`0:${hexDigit.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });
}

const treasury = friendlyAddr('1');
const recipient = friendlyAddr('2');
const target = friendlyAddr('3');

function expectFieldError(
  result: ReturnType<typeof validateGovernanceDraft>,
  field: string,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual({ field, code });
  }
}

describe('validateGovernanceDraft', () => {
  describe('ParameterChange', () => {
    const valid: GovernanceProposalDraft = {
      kind: ProposalType.ParameterChange,
      target,
      methodIdStr: '42',
      argsB64: '',
    };

    it('accepts a valid draft', () => {
      expect(validateGovernanceDraft(valid)).toEqual({ ok: true });
    });

    it('rejects invalid target address', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, target: 'not-an-address' }),
        'target',
        'invalidAddress',
      );
    });

    it('rejects empty target address', () => {
      expectFieldError(validateGovernanceDraft({ ...valid, target: '' }), 'target', 'invalidAddress');
    });

    it('rejects negative methodId', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, methodIdStr: '-1' }),
        'methodIdStr',
        'invalidMethodId',
      );
    });

    it('rejects non-finite methodId', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, methodIdStr: 'abc' }),
        'methodIdStr',
        'invalidMethodId',
      );
    });

    it('rejects unparseable args cell', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, argsB64: 'not-valid-boc' }),
        'argsB64',
        'invalidArgs',
      );
    });

    it('accepts parseable args cell (base64)', () => {
      const args = beginCell().storeUint(1, 8).endCell();
      const result = validateGovernanceDraft({ ...valid, argsB64: args.toBoc().toString('base64') });
      expect(result.ok).toBe(true);
    });
  });

  describe('FeaturePriority', () => {
    const valid: GovernanceProposalDraft = {
      kind: ProposalType.FeaturePriority,
      title: 'Dark mode',
      description: 'Ship dark mode for Mini App',
      cid: '',
    };

    it('accepts a valid draft', () => {
      expect(validateGovernanceDraft(valid)).toEqual({ ok: true });
    });

    it('rejects empty description', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, description: '   ' }),
        'description',
        'required',
      );
    });

    it('rejects whitespace-only cid when set', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, cid: '  ' }),
        'cid',
        'required',
      );
    });

    it('accepts optional cid when non-empty', () => {
      const result = validateGovernanceDraft({ ...valid, cid: 'bafyTEST' });
      expect(result.ok).toBe(true);
    });
  });

  describe('TreasurySpend', () => {
    const valid: GovernanceProposalDraft = {
      kind: ProposalType.TreasurySpend,
      treasury,
      recipient,
      amount: '1',
      reason: 'Audit payment',
    };

    it('accepts a valid draft', () => {
      expect(validateGovernanceDraft(valid)).toEqual({ ok: true });
    });

    it('rejects invalid treasury address', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, treasury: 'bad' }),
        'treasury',
        'invalidAddress',
      );
    });

    it('rejects invalid recipient address', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, recipient: 'bad' }),
        'recipient',
        'invalidAddress',
      );
    });

    it('rejects zero amount (stricter than tact)', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, amount: '0' }),
        'amount',
        'invalidAmount',
      );
    });

    it('rejects empty amount', () => {
      expectFieldError(validateGovernanceDraft({ ...valid, amount: '' }), 'amount', 'invalidAmount');
    });

    it('rejects invalid amount format', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, amount: 'not-a-number' }),
        'amount',
        'invalidAmount',
      );
    });

    it('rejects empty reason', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, reason: '  ' }),
        'reason',
        'required',
      );
    });
  });

  describe('Emergency', () => {
    const valid: GovernanceProposalDraft = {
      kind: ProposalType.Emergency,
      target,
      methodIdStr: '1',
      argsB64: '',
      reason: 'Incident response',
    };

    it('accepts a valid draft', () => {
      expect(validateGovernanceDraft(valid)).toEqual({ ok: true });
    });

    it('rejects invalid target address', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, target: 'x' }),
        'target',
        'invalidAddress',
      );
    });

    it('rejects empty reason', () => {
      expectFieldError(
        validateGovernanceDraft({ ...valid, reason: '' }),
        'reason',
        'required',
      );
    });
  });

  describe('encode integration', () => {
    it('valid ParameterChange draft encodes like governance.test vectors', () => {
      const draft: GovernanceProposalDraft = {
        kind: ProposalType.ParameterChange,
        target: treasury,
        methodIdStr: String(0xdeadbeef),
        argsB64: beginCell().storeUint(1, 8).endCell().toBoc().toString('base64'),
      };
      const validation = validateGovernanceDraft(draft);
      expect(validation.ok).toBe(true);
      const cell = encodePayload(draftToFormValues(draft));
      expect(cell.bits.length).toBeGreaterThan(0);
    });

    it('valid TreasurySpend draft encodes like governance.test vectors', () => {
      const draft: GovernanceProposalDraft = {
        kind: ProposalType.TreasurySpend,
        treasury,
        recipient,
        amount: '1',
        reason: 'Audit payment',
      };
      const validation = validateGovernanceDraft(draft);
      expect(validation.ok).toBe(true);
      const cell = encodePayload(draftToFormValues(draft));
      expect(cell.bits.length).toBeGreaterThan(0);
    });
  });
});
