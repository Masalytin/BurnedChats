// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMessageSelection } from '../useMessageSelection';

describe('useMessageSelection', () => {
  it('starts idle with empty set', () => {
    const { result } = renderHook(() => useMessageSelection());
    expect(result.current.mode).toBe('idle');
    expect(result.current.count).toBe(0);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('enterSelectionWith adds id and switches to selecting', () => {
    const { result } = renderHook(() => useMessageSelection());
    act(() => {
      result.current.enterSelectionWith('m1');
    });
    expect(result.current.mode).toBe('selecting');
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('m1')).toBe(true);
  });

  it('toggle adds and removes ids', () => {
    const { result } = renderHook(() => useMessageSelection());
    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.isSelected('a')).toBe(true);
    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.mode).toBe('idle');
  });

  it('clear resets to idle', () => {
    const { result } = renderHook(() => useMessageSelection());
    act(() => {
      result.current.enterSelectionWith('x');
    });
    expect(result.current.count).toBe(1);
    act(() => {
      result.current.clear();
    });
    expect(result.current.count).toBe(0);
    expect(result.current.mode).toBe('idle');
  });

  it('extendTo selects range between anchor and end', () => {
    const { result } = renderHook(() => useMessageSelection());
    const order = ['a', 'b', 'c', 'd'] as const;
    act(() => {
      result.current.enterSelectionWith('b');
    });
    act(() => {
      result.current.extendTo('d', order);
    });
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.isSelected('c')).toBe(true);
    expect(result.current.isSelected('d')).toBe(true);
  });
});
