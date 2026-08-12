// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  closeDmInviteSheet,
  shouldAutoDismissDmInviteSheet,
} from '../dmInviteUi';

describe('dmInviteUi', () => {
  it('closeDmInviteSheet closes UI and resets minted invite state', () => {
    const setOpen = vi.fn();
    const resetInvite = vi.fn();

    closeDmInviteSheet(setOpen, resetInvite);

    expect(setOpen).toHaveBeenCalledWith(false);
    expect(resetInvite).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses when leaving home while sheet is still open', () => {
    expect(shouldAutoDismissDmInviteSheet('incoming-request', true)).toBe(true);
    expect(shouldAutoDismissDmInviteSheet('chat', true)).toBe(true);
    expect(shouldAutoDismissDmInviteSheet('home', true)).toBe(false);
    expect(shouldAutoDismissDmInviteSheet('chat', false)).toBe(false);
  });
});
