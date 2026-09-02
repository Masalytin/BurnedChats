import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyPresenceEvent,
  derivePresence,
  getPresence,
  resetPresenceStore,
  seedPresence,
  PRESENCE_STALE_MS,
} from './presenceStore';

describe('presenceStore', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('applies a live event without remounting state identity', () => {
    seedPresence('peer-1', { online: false });
    applyPresenceEvent('peer-1', true, 1_700_000_000_000);
    expect(getPresence('peer-1')).toEqual({
      online: true,
      lastSeen: 1_700_000_000_000,
    });
  });

  it('event wins over snapshot seed', () => {
    seedPresence('peer-1', { online: false });
    applyPresenceEvent('peer-1', true, 100);
    const derived = derivePresence(getPresence('peer-1'), { online: false }, 100);
    expect(derived.online).toBe(true);
  });

  it('derives offline when lastSeen is older than 35s', () => {
    const lastSeen = 1_000;
    const derived = derivePresence(
      { online: true, lastSeen },
      { online: true },
      lastSeen + PRESENCE_STALE_MS + 1,
    );
    expect(derived.online).toBe(false);
    expect(derived.lastSeen).toBe(lastSeen);
  });

  it('does not stale-flip when live is false (search snapshot)', () => {
    const lastSeen = 1_000;
    const derived = derivePresence(
      { online: true, lastSeen },
      { online: true },
      lastSeen + PRESENCE_STALE_MS + 1,
      { live: false },
    );
    expect(derived.online).toBe(true);
  });

  it('does not overwrite an existing entry on seed', () => {
    applyPresenceEvent('peer-1', true, 50);
    seedPresence('peer-1', { online: false });
    expect(getPresence('peer-1')?.online).toBe(true);
  });
});
