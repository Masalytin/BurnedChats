// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createPendingEditPromise,
  resolvePendingMessageAck,
  type PendingMessageResolversRef,
} from '../useMessageCore';

function makeResolversRef(): PendingMessageResolversRef {
  return { current: new Map() };
}

function makeTimeoutsRef() {
  return { current: new Map<string, number>() };
}

describe('createPendingEditPromise', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when publish runs and ack arrives', async () => {
    const ref = makeResolversRef();
    const timeouts = makeTimeoutsRef();
    const publishEdit = vi.fn();

    const promise = createPendingEditPromise('msg-1', ref, timeouts, publishEdit, 15_000);
    expect(publishEdit).toHaveBeenCalledTimes(1);

    resolvePendingMessageAck(ref, 'msg-1', { success: true }, timeouts);
    await expect(promise).resolves.toEqual({ success: true });
    expect(ref.current.has('msg-1')).toBe(false);
  });

  it('resolves with errorCode when ack reports failure', async () => {
    const ref = makeResolversRef();
    const timeouts = makeTimeoutsRef();
    const promise = createPendingEditPromise('msg-2', ref, timeouts, () => {}, 15_000);

    resolvePendingMessageAck(ref, 'msg-2', { success: false, errorCode: 'NOT_EDITABLE' }, timeouts);
    await expect(promise).resolves.toEqual({ success: false, errorCode: 'NOT_EDITABLE' });
  });

  it('times out with TIMEOUT when no ack arrives', async () => {
    const ref = makeResolversRef();
    const timeouts = makeTimeoutsRef();
    const promise = createPendingEditPromise('msg-3', ref, timeouts, () => {}, 15_000);

    vi.advanceTimersByTime(15_000);
    await expect(promise).resolves.toEqual({ success: false, errorCode: 'TIMEOUT' });
  });

  it('supersedes prior pending edit for the same messageId', async () => {
    const ref = makeResolversRef();
    const timeouts = makeTimeoutsRef();
    const first = createPendingEditPromise('msg-4', ref, timeouts, () => {}, 15_000);
    const second = createPendingEditPromise('msg-4', ref, timeouts, () => {}, 15_000);

    await expect(first).resolves.toEqual({ success: false, errorCode: 'SUPERSEDED' });

    resolvePendingMessageAck(ref, 'msg-4', { success: true }, timeouts);
    await expect(second).resolves.toEqual({ success: true });
  });
});

describe('resolvePendingMessageAck', () => {
  it('returns false when no pending resolver exists', () => {
    const ref = makeResolversRef();
    expect(resolvePendingMessageAck(ref, 'missing', { success: true })).toBe(false);
  });
});
