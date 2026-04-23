import type { TFunction } from 'i18next';
import type { DecryptedFileMessage, DecryptedMessage, MessageType, ReplyToInfo } from '@/types';
import i18n from '@/i18n';

function isFileMessage(msg: DecryptedMessage): msg is DecryptedFileMessage {
  return msg.type !== 'text' && 'fileId' in msg && typeof (msg as DecryptedFileMessage).fileId === 'string';
}

function fileContentPlaceholder(type: MessageType, fileName?: string): string {
  const name = fileName || 'file';
  switch (type) {
    case 'image':
      return `📷 ${name}`;
    case 'video':
      return `🎬 ${name}`;
    case 'file':
      return `📎 ${name}`;
    default:
      return name;
  }
}

const MAX = 80;

/**
 * One-line reply preview (≤80 chars) from decrypted message: content, caption, fileName, or type fallback.
 */
export function makeReplyPreview(message: DecryptedMessage, t: TFunction = i18n.t.bind(i18n)): string {
  let line: string;
  if (message.type === 'text') {
    line = message.content.trim();
  } else if (isFileMessage(message)) {
    const fn = message.fileMeta?.fileName ?? '';
    const placeholder = fileContentPlaceholder(message.type, fn || undefined);
    if (message.content.trim() !== '' && message.content !== placeholder) {
      line = message.content.trim();
    } else if (fn) {
      line = fn;
    } else {
      line =
        message.type === 'image'
          ? t('chat.reply.imageShort')
          : message.type === 'video'
            ? t('chat.reply.videoShort')
            : t('chat.reply.fileShort');
    }
  } else {
    line = message.content;
  }
  if (line.length > MAX) {
    return `${line.slice(0, MAX - 1)}…`;
  }
  return line;
}

export function resolveReplyAuthor(
  message: DecryptedMessage,
  userId: number,
  peerDisplayName: string,
  t: TFunction = i18n.t.bind(i18n),
): string {
  if (message.isOwn || message.fromUserId === userId) {
    return t('chat.reply.you');
  }
  const name = message.senderName?.trim();
  if (name) {
    return name;
  }
  return peerDisplayName;
}

/**
 * Build `replyTo` for a message with `replyToMessageId` using the current message list.
 */
export function enrichReplyTo(
  m: DecryptedMessage,
  allMessages: DecryptedMessage[],
  t: TFunction = i18n.t.bind(i18n),
): DecryptedMessage {
  if (!m.replyToMessageId) {
    if (m.replyTo === undefined) {
      return m;
    }
    const { replyTo: _r, ...rest } = m;
    return rest as DecryptedMessage;
  }

  const orig = allMessages.find((x) => x.id === m.replyToMessageId);
  if (!orig) {
    return {
      ...m,
      replyTo: {
        messageId: m.replyToMessageId,
        senderId: 0,
        preview: t('chat.reply.deletedOriginal'),
        type: 'text',
        deleted: true,
      },
    };
  }

  return {
    ...m,
    replyTo: {
      messageId: orig.id,
      senderId: orig.fromUserId,
      senderName: orig.senderName,
      preview: makeReplyPreview(orig, t),
      type: orig.type,
    },
  };
}

export function quoteSenderLabel(
  reply: ReplyToInfo,
  userId: number,
  peerDisplayName: string,
  t: TFunction = i18n.t.bind(i18n),
): string {
  if (reply.deleted) {
    return t('chat.reply.unknownSender');
  }
  if (reply.senderName?.trim()) {
    return reply.senderName.trim();
  }
  if (reply.senderId === userId) {
    return t('chat.reply.you');
  }
  return peerDisplayName;
}
