import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
  SET_FEE_PARAMS_OP,
  SET_GAS_PARAMS_OP,
  buildSetFeeParamsArgsCell,
  buildSetGasParamsArgsCell,
  draftToFormValues,
} from '@/components/Governance/PayloadEditor';
import { ProposalType } from '@/types/ton';
import { encodePayload } from '@/utils/governance-encode';

const TARGET = `0:${'11'.repeat(32)}`;

describe('ParameterChange presets', () => {
  it('builds SetFeeParams args as queryId + three bps ints (no opcode)', () => {
    const cell = buildSetFeeParamsArgsCell(30, 30, 40);
    const slice = cell.beginParse();
    expect(slice.loadUint(64)).toBe(0);
    expect(slice.loadInt(257)).toBe(30);
    expect(slice.loadInt(257)).toBe(30);
    expect(slice.loadInt(257)).toBe(40);
    expect(slice.remainingBits).toBe(0);
  });

  it('builds SetGasParams args as queryId + six coins (no opcode)', () => {
    const cell = buildSetGasParamsArgsCell({
      minTonFeePath: '1.5',
      perInternalDeployTon: '0.1',
      poolForwardMin: '0.05',
      treasuryForwardMin: '0.05',
      burnNotifyTon: '0.05',
      propagateTon: '0.05',
    });
    const slice = cell.beginParse();
    expect(slice.loadUint(64)).toBe(0);
    expect(slice.loadCoins()).toBe(1_500_000_000n);
    expect(slice.loadCoins()).toBe(100_000_000n);
    expect(slice.loadCoins()).toBe(50_000_000n);
    expect(slice.loadCoins()).toBe(50_000_000n);
    expect(slice.loadCoins()).toBe(50_000_000n);
    expect(slice.loadCoins()).toBe(50_000_000n);
    expect(slice.remainingBits).toBe(0);
  });

  it('parses hex methodId in draftToFormValues', () => {
    const form = draftToFormValues({
      kind: ProposalType.ParameterChange,
      target: TARGET,
      methodIdStr: `0x${SET_FEE_PARAMS_OP.toString(16)}`,
      argsB64: buildSetFeeParamsArgsCell(10, 20, 30).toBoc({ idx: false }).toString('base64'),
    });
    expect(form.type).toBe(ProposalType.ParameterChange);
    if (form.type !== ProposalType.ParameterChange) {
      throw new Error('expected ParameterChange');
    }
    expect(form.values.methodId).toBe(SET_FEE_PARAMS_OP);
  });

  it('encodePayload stores methodId on the outer cell and args without repeating opcode', () => {
    const args = buildSetFeeParamsArgsCell(30, 30, 40);
    const payload = encodePayload({
      type: ProposalType.ParameterChange,
      values: {
        target: Address.parse(TARGET).toString(),
        methodId: SET_FEE_PARAMS_OP,
        args,
      },
    });
    const slice = payload.beginParse();
    slice.loadAddress();
    expect(slice.loadUint(32)).toBe(SET_FEE_PARAMS_OP);
    const argsSlice = slice.loadRef().beginParse();
    expect(argsSlice.loadUint(64)).toBe(0);
    expect(argsSlice.loadInt(257)).toBe(30);
  });

  it('SetGasParams opcode is distinct from SetFeeParams', () => {
    expect(SET_GAS_PARAMS_OP).toBe(0x5a1c8f07);
    expect(SET_FEE_PARAMS_OP).not.toBe(SET_GAS_PARAMS_OP);
  });
});
