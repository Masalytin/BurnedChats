import { useCallback, useMemo, useState } from 'react';

export type MessageSelectionMode = 'idle' | 'selecting';

export interface UseMessageSelectionReturn {
  mode: MessageSelectionMode;
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  enterSelectionWith: (id: string) => void;
  clear: () => void;
  count: number;
}

/**
 * Multi-select state for message actions. When the last item is deselected,
 * mode automatically returns to `idle`.
 */
export function useMessageSelection(): UseMessageSelectionReturn {
  const [rawIds, setRawIds] = useState<Set<string>>(() => new Set());

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
      setIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    [setIds],
  );

  const clear = useCallback(() => {
    setRawIds(new Set());
  }, []);

  return {
    mode,
    selectedIds,
    isSelected,
    toggle,
    enterSelectionWith,
    clear,
    count,
  };
}
