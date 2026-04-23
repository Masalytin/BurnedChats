// @vitest-environment jsdom
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
});
