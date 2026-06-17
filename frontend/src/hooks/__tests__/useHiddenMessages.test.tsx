// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hiddenMessagesStorageKey } from '@/utils/hiddenMessagesStorage';
import { useHiddenMessages } from '../useHiddenMessages';

describe('useHiddenMessages', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('hide persists to sessionStorage', () => {
    const { result } = renderHook(() => useHiddenMessages('dm', 'sess-1'));
    act(() => {
      result.current.hide('m1');
    });
    expect(result.current.hiddenIds.has('m1')).toBe(true);
    const raw = sessionStorage.getItem(hiddenMessagesStorageKey('dm', 'sess-1'));
    expect(raw).toContain('m1');
  });

  it('hide accepts array of ids', () => {
    const { result } = renderHook(() => useHiddenMessages('room', 'r1'));
    act(() => {
      result.current.hide(['a', 'b']);
    });
    expect(result.current.hiddenIds.has('a')).toBe(true);
    expect(result.current.hiddenIds.has('b')).toBe(true);
  });

  it('unhide removes id', () => {
    const { result } = renderHook(() => useHiddenMessages('dm', 's2'));
    act(() => {
      result.current.hide('x');
    });
    act(() => {
      result.current.unhide('x');
    });
    expect(result.current.hiddenIds.has('x')).toBe(false);
  });

  it('clear removes storage key', () => {
    const { result } = renderHook(() => useHiddenMessages('dm', 's3'));
    act(() => {
      result.current.hide('z');
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.hiddenIds.size).toBe(0);
    expect(sessionStorage.getItem(hiddenMessagesStorageKey('dm', 's3'))).toBeNull();
  });

  it('reloads from storage when scopeId changes', () => {
    sessionStorage.setItem(hiddenMessagesStorageKey('dm', 'new-id'), JSON.stringify(['p']));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useHiddenMessages('dm', id),
      { initialProps: { id: 'other' } },
    );
    expect(result.current.hiddenIds.has('p')).toBe(false);
    rerender({ id: 'new-id' });
    expect(result.current.hiddenIds.has('p')).toBe(true);
  });
});
