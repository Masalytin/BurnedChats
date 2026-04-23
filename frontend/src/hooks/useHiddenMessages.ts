import { useCallback, useEffect, useState } from 'react';
import {
  clearHiddenMessagesStorage,
  readHiddenMessageIds,
  writeHiddenMessageIds,
} from '@/utils/hiddenMessagesStorage';

export function useHiddenMessages(scope: 'dm' | 'room', scopeId: string): {
  hiddenIds: ReadonlySet<string>;
  hide: (messageId: string | string[]) => void;
  unhide: (messageId: string) => void;
  clear: () => void;
} {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() =>
    readHiddenMessageIds(scope, scopeId),
  );

  useEffect(() => {
    setHiddenIds(readHiddenMessageIds(scope, scopeId));
  }, [scope, scopeId]);

  const hide = useCallback(
    (messageId: string | string[]) => {
      const ids = Array.isArray(messageId) ? messageId : [messageId];
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          next.add(id);
        }
        writeHiddenMessageIds(scope, scopeId, next);
        return next;
      });
    },
    [scope, scopeId],
  );

  const unhide = useCallback(
    (messageId: string) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        writeHiddenMessageIds(scope, scopeId, next);
        return next;
      });
    },
    [scope, scopeId],
  );

  const clear = useCallback(() => {
    clearHiddenMessagesStorage(scope, scopeId);
    setHiddenIds(new Set());
  }, [scope, scopeId]);

  return { hiddenIds, hide, unhide, clear };
}
