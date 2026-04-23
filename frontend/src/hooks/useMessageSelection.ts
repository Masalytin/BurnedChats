import { useCallback, useMemo, useState } from 'react';

export type MessageSelectionMode = 'idle' | 'selecting';

export interface UseMessageSelectionReturn {
  mode: MessageSelectionMode;
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  enterSelectionWith: (id: string) => void;
  /** Selects all message ids between the current range anchor and `endId` (inclusive, by `orderedIds` order). */
  extendTo: (endId: string, orderedIds: readonly string[]) => void;
  clear: () => void;
  count: number;
}

/**
 * Multi-select state for message actions. When the last item is deselected,
 * mode automatically returns to `idle`.
 */
export function useMessageSelection(): UseMessageSelectionReturn {
  const [rawIds, setRawIds] = useState<Set<string>>(() => new Set());
  /** Anchor for Shift+arrow range selection (last explicit toggle / enter). */
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);

  const count = rawIds.size;
  const mode: MessageSelectionMode = count > 0 ? 'selecting' : 'idle';

  const selectedIds = useMemo(() => new Set(rawIds) as ReadonlySet<string>, [rawIds]);

  const isSelected = useCallback((id: string) => rawIds.has(id), [rawIds]);

  const setIds = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setRawIds((prev) => {
        const next = updater(prev);
        return next;
      });
    },
    [],
  );

  const toggle = useCallback(
    (id: string) => {
      setRangeAnchorId(id);
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [setIds],
  );

  const enterSelectionWith = useCallback(
    (id: string) => {
      setRangeAnchorId(id);
      setIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    [setIds],
  );

  const extendTo = useCallback(
    (endId: string, orderedIds: readonly string[]) => {
      const anchor = rangeAnchorId ?? endId;
      const ia = orderedIds.indexOf(anchor);
      const ib = orderedIds.indexOf(endId);
      if (ia < 0 || ib < 0) {
        return;
      }
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      setIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          next.add(orderedIds[i]!);
        }
        return next;
      });
    },
    [setIds, rangeAnchorId],
  );

  const clear = useCallback(() => {
    setRawIds(new Set());
    setRangeAnchorId(null);
  }, []);

  return {
    mode,
    selectedIds,
    isSelected,
    toggle,
    enterSelectionWith,
    extendTo,
    clear,
    count,
  };
}
