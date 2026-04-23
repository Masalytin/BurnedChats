import type { DecryptedFileMessage, DecryptedMessage, MessageType } from '@/types';

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

function isFileMessage(msg: DecryptedMessage): msg is DecryptedFileMessage {
  return msg.type !== 'text' && 'fileId' in msg && typeof (msg as DecryptedFileMessage).fileId === 'string';
}

/** One line of text to copy for a single message (text / caption / fileName). */
export function copyLineForMessage(message: DecryptedMessage): string {
  if (message.type === 'text') {
    return message.content;
  }
  if (isFileMessage(message)) {
    const fn = message.fileMeta?.fileName ?? '';
    const placeholder = fileContentPlaceholder(message.type, fn || undefined);
    if (message.content.trim() !== '' && message.content !== placeholder) {
      return message.content;
    }
    return fn || message.content;
  }
  return message.content;
}

export function buildCopyText(
  messages: DecryptedMessage[],
  opts?: { includeSenderName?: boolean },
): string {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const lines = sorted.map((m) => {
    let line = copyLineForMessage(m);
    if (opts?.includeSenderName) {
      const name = m.senderName?.trim();
      if (name) {
        line = `${name}: ${line}`;
      }
    }
    return line;
  });
  return lines.join('\n\n');
}
