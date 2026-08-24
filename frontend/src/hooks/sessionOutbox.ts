/** In-session RAM outbox for outgoing text while WebSocket is down (IMP-OFFLINE-01). */

export interface SessionOutboxItem {
  contextId: string;
  text: string;
  replyToMessageId?: string;
}

export interface SessionOutbox {
  enqueue(item: SessionOutboxItem): void;
  drain(): SessionOutboxItem[];
  size(): number;
}

export interface OutgoingFileBlob {
  file: File;
  caption?: string;
}

export interface FileBlobOutbox {
  remember(messageId: string, blob: OutgoingFileBlob): void;
  get(messageId: string): OutgoingFileBlob | undefined;
  forget(messageId: string): void;
}

export function createFileBlobOutbox(): FileBlobOutbox {
  const map = new Map<string, OutgoingFileBlob>();
  return {
    remember(messageId, blob) {
      if (!messageId) {
        return;
      }
      map.set(messageId, blob);
    },
    get(messageId) {
      return map.get(messageId);
    },
    forget(messageId) {
      map.delete(messageId);
    },
  };
}

export function createSessionOutbox(): SessionOutbox {
  const items: SessionOutboxItem[] = [];
  return {
    enqueue(item) {
      const text = item.text.trim();
      if (!text || !item.contextId) {
        return;
      }
      items.push({ ...item, text });
    },
    drain() {
      return items.splice(0, items.length);
    },
    size() {
      return items.length;
    },
  };
}
