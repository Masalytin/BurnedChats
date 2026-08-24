// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createFileBlobOutbox, createSessionOutbox } from '../sessionOutbox';

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

describe('createFileBlobOutbox', () => {
  it('keeps File in RAM for retry and does not persist the name to storage', () => {
    const box = createFileBlobOutbox();
    const file = new File(['abc'], 'secret-blob.bin', { type: 'application/octet-stream' });
    box.remember('msg-1', { file, caption: 'cap' });
    expect(box.get('msg-1')?.file).toBe(file);
    expect(box.get('msg-1')?.caption).toBe('cap');
    box.forget('msg-1');
    expect(box.get('msg-1')).toBeUndefined();

    expect(JSON.stringify(localStorage)).not.toContain('secret-blob.bin');
    expect(JSON.stringify(sessionStorage)).not.toContain('secret-blob.bin');
  });
});
