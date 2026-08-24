// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionOutbox } from '../sessionOutbox';

describe('createSessionOutbox', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('queues text in RAM and drains FIFO after reconnect', () => {
    const box = createSessionOutbox();
    box.enqueue({ contextId: 'sess-1', text: 'first' });
    box.enqueue({ contextId: 'sess-1', text: 'second', replyToMessageId: 'm1' });
    expect(box.size()).toBe(2);

    const first = box.drain();
    expect(first).toEqual([
      { contextId: 'sess-1', text: 'first' },
      { contextId: 'sess-1', text: 'second', replyToMessageId: 'm1' },
    ]);
    expect(box.size()).toBe(0);
    expect(box.drain()).toEqual([]);
  });

  it('does not write plaintext to localStorage or sessionStorage', () => {
    const box = createSessionOutbox();
    box.enqueue({ contextId: 'sess-1', text: 'secret-offline-draft' });
    box.drain();

    const ls = JSON.stringify(localStorage);
    const ss = JSON.stringify(sessionStorage);
    expect(ls).not.toContain('secret-offline-draft');
    expect(ss).not.toContain('secret-offline-draft');
  });
});
