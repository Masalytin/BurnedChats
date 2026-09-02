// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPresenceEvent, resetPresenceStore } from '../presence/presenceStore';
import { usePresence } from './usePresence';

describe('usePresence', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('flips online when a PresenceEvent arrives without remounting', () => {
    const { result } = renderHook(() => usePresence('peer-1', { online: false }));

    expect(result.current.online).toBe(false);

    act(() => {
      applyPresenceEvent('peer-1', true, Date.now());
    });

    expect(result.current.online).toBe(true);
  });
});
