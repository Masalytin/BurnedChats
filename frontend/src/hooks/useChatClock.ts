import { useSyncExternalStore } from 'react';

const TICK_MS = 1000;

let nowMs = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function emitTick(): void {
  nowMs = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function ensureScheduler(): void {
  if (intervalId != null) {
    return;
  }
  intervalId = setInterval(emitTick, TICK_MS);
}

function stopSchedulerIfIdle(): void {
  if (listeners.size > 0 || intervalId == null) {
    return;
  }
  clearInterval(intervalId);
  intervalId = null;
}

function subscribeToTick(listener: () => void): () => void {
  listeners.add(listener);
  nowMs = Date.now();
  ensureScheduler();
  return () => {
    listeners.delete(listener);
    stopSchedulerIfIdle();
  };
}

function subscribeNoop(): () => void {
  return () => {};
}

function getSnapshot(): number {
  return nowMs;
}

/** Subscribe to the shared 1s chat clock only when `subscribe` is true. */
export function useNow(subscribe: boolean): number {
  return useSyncExternalStore(
    subscribe ? subscribeToTick : subscribeNoop,
    getSnapshot,
    getSnapshot,
  );
}

/**
 * Shared chat clock. One interval for the process; bubbles call `useNow(true)`
 * only when they need a live remaining readout.
 */
export function useChatClock(): { nowMs: number; useNow: typeof useNow } {
  const snapshotMs = useNow(false);
  return { nowMs: snapshotMs, useNow };
}

/** Test seam: drop subscribers and the process-wide interval. */
export function resetChatClockForTests(): void {
  listeners.clear();
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  nowMs = Date.now();
}
