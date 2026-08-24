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
