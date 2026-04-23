import { describe, expect, it } from 'vitest';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';
import { buildCopyText, copyLineForMessage } from '../copyMessage';

const textMsg = (content: string): DecryptedMessage => ({
  id: '1',
  sessionId: 's',
  fromUserId: 1,
  content,
  timestamp: 100,
  status: 'delivered',
  isOwn: false,
  type: 'text',
});

const fileMsg = (partial: Partial<DecryptedFileMessage> & Pick<DecryptedFileMessage, 'type' | 'content'>): DecryptedFileMessage => ({
  id: 'f1',
  sessionId: 's',
  fromUserId: 1,
  timestamp: 200,
  status: 'delivered',
  isOwn: false,
  fileId: 'fid',
  fileSize: 1,
  fileMeta: { fileName: 'doc.pdf', mimeType: 'application/pdf' },
  ...partial,
});

describe('copyLineForMessage', () => {
  it('copies text content', () => {
    expect(copyLineForMessage(textMsg('hi'))).toBe('hi');
  });

  it('copies caption when file message has user caption', () => {
    const m = fileMsg({ type: 'image', content: 'my caption' });
    expect(copyLineForMessage(m)).toBe('my caption');
  });

  it('copies fileName when content is only placeholder', () => {
    const m = fileMsg({ type: 'image', content: '📷 doc.pdf' });
    expect(copyLineForMessage(m)).toBe('doc.pdf');
  });
});

describe('buildCopyText', () => {
  it('joins multiple messages with blank line', () => {
    const a = textMsg('a');
    a.timestamp = 2;
    const b = textMsg('b');
    b.timestamp = 1;
    expect(buildCopyText([a, b])).toBe('b\n\na');
  });

  it('prefixes sender when includeSenderName', () => {
    const m = textMsg('x');
    m.senderName = 'Alice';
    expect(buildCopyText([m], { includeSenderName: true })).toBe('Alice: x');
  });
});
