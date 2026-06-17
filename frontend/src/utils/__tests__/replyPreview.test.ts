// @vitest-environment happy-dom
import { vi } from 'vitest';
import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
  },
}));

import { makeReplyPreview, enrichReplyTo, resolveReplyAuthor } from '../replyPreview';

const t = ((key: string) => {
  if (key === 'chat.reply.imageShort') return 'Image';
  if (key === 'chat.reply.deletedOriginal') return 'Deleted';
  if (key === 'chat.reply.you') return 'You';
  if (key === 'chat.reply.unknownSender') return 'Unknown';
  return key;
}) as TFunction;

function textMsg(over: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: '1',
    sessionId: 's',
    fromUserId: 1,
    content: 'hello',
    timestamp: 1,
    status: 'delivered',
    isOwn: true,
    type: 'text',
    ...over,
  };
}

describe('makeReplyPreview', () => {
  it('truncates long text to 80 chars with ellipsis', () => {
    const long = 'a'.repeat(100);
    const p = makeReplyPreview(textMsg({ content: long }), t);
    expect(p.length).toBe(80);
    expect(p.endsWith('…')).toBe(true);
  });

  it('uses caption for file when not placeholder', () => {
    const m: DecryptedFileMessage = {
      ...textMsg({ type: 'image', isOwn: false, content: 'cap' }) as DecryptedFileMessage,
      fileId: 'f',
      fileSize: 1,
      fileMeta: { fileName: 'a.png', mimeType: 'image/png' },
    };
    expect(makeReplyPreview(m, t)).toBe('cap');
  });
});

describe('enrichReplyTo', () => {
  it('marks deleted when original missing', () => {
    const m = textMsg({ id: 'x', replyToMessageId: 'missing' });
    const o = enrichReplyTo(m, [m], t);
    expect(o.replyTo?.deleted).toBe(true);
    expect(o.replyTo?.preview).toBe('Deleted');
  });

  it('hydrates from original in list', () => {
    const orig = textMsg({ id: 'a', fromUserId: 2, content: 'orig', isOwn: false });
    const m = textMsg({ id: 'b', replyToMessageId: 'a' });
    const o = enrichReplyTo(m, [orig, m], t);
    expect(o.replyTo?.messageId).toBe('a');
    expect(o.replyTo?.preview).toBe('orig');
  });
});

describe('resolveReplyAuthor', () => {
  it('uses You for own', () => {
    expect(resolveReplyAuthor(textMsg({ isOwn: true }), 1, 'P', t)).toBe('You');
  });
});
