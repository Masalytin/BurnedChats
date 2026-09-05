import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  clampAfterSnap,
  columnMax,
  type DurationParts,
  type DurationPickerMode,
} from '../../utils/durationColumns';
import './DurationScrollPicker.css';

export type { DurationPickerMode };

export type DurationScrollPickerProps = {
  mode: DurationPickerMode;
  valueParts: [number, number, number];
  onCommitParts: (parts: [number, number, number]) => void;
  minSeconds: number;
  maxSeconds: number;
  disabled?: boolean;
  ariaLabel?: string;
};

type ColumnDef = {
  id: string;
  ariaKey: string;
  unitKey: string;
  max: number;
};

const FALLBACK_ITEM_HEIGHT = 44;
const LIVE_ITEM_CLASS = 'duration-scroll-picker__item--live';

function columnsForMode(mode: DurationPickerMode): ColumnDef[] {
  const max = columnMax(mode);
  if (mode === 'hms') {
    return [
      {
        id: 'hours',
        ariaKey: 'common.duration.picker.columnHours',
        unitKey: 'common.duration.unitHours',
        max: max[0],
      },
      {
        id: 'minutes',
        ariaKey: 'common.duration.picker.columnMinutes',
        unitKey: 'common.duration.unitMinutes',
        max: max[1],
      },
      {
        id: 'seconds',
        ariaKey: 'common.duration.picker.columnSeconds',
        unitKey: 'common.duration.unitSeconds',
        max: max[2],
      },
    ];
  }
  return [
    {
      id: 'days',
      ariaKey: 'common.duration.picker.columnDays',
      unitKey: 'common.duration.unitDays',
      max: max[0],
    },
    {
      id: 'hours',
      ariaKey: 'common.duration.picker.columnHours',
      unitKey: 'common.duration.unitHours',
      max: max[1],
    },
    {
      id: 'minutes',
      ariaKey: 'common.duration.picker.columnMinutes',
      unitKey: 'common.duration.unitMinutes',
      max: max[2],
    },
  ];
}

function readItemHeight(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue('--bc-touch-target');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ITEM_HEIGHT;
}

function indexFromScrollTop(scrollTop: number, itemHeight: number, max: number): number {
  const raw = Math.round(scrollTop / itemHeight);
  return Math.min(max, Math.max(0, raw));
}

function partsEqual(a: DurationParts, b: DurationParts): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function hasScrollendSupport(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.onscrollend !== 'undefined';
}

function applyLiveItem(
  wheel: HTMLElement | null,
  previous: Element | null,
  index: number
): Element | null {
  if (!wheel) {
    return previous;
  }
  const next = wheel.children[index] ?? null;
  if (previous === next) {
    return previous;
  }
  previous?.classList.remove(LIVE_ITEM_CLASS);
  next?.classList.add(LIVE_ITEM_CLASS);
  return next;
}

export function DurationScrollPicker({
  mode,
  valueParts,
  onCommitParts,
  maxSeconds,
  disabled = false,
  ariaLabel,
}: DurationScrollPickerProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const columns = useMemo(() => columnsForMode(mode), [mode]);
  const itemLists = useMemo(
    () => columns.map((col) => Array.from({ length: col.max + 1 }, (_, index) => index)),
    [columns]
  );

  const wheelRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const indexRefs = useRef<DurationParts>([valueParts[0], valueParts[1], valueParts[2]]);
  const valuePartsRef = useRef<DurationParts>(valueParts);
  valuePartsRef.current = valueParts;
  const lastSyncedPartsRef = useRef<DurationParts | null>(null);
  const liveItemRefs = useRef<Array<Element | null>>([null, null, null]);
  const rafCommitRef = useRef<[number, number, number]>([0, 0, 0]);
  const ignoreClickRef = useRef<[boolean, boolean, boolean]>([false, false, false]);
  const pointerStartTopRef = useRef<[number, number, number]>([0, 0, 0]);

  const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

  const cancelRafCommit = (colIndex: number): void => {
    const id = rafCommitRef.current[colIndex];
    if (id !== 0) {
      cancelAnimationFrame(id);
      rafCommitRef.current[colIndex] = 0;
    }
  };

  const applyLiveForParts = (parts: DurationParts): void => {
    columns.forEach((_, colIndex) => {
      liveItemRefs.current[colIndex] = applyLiveItem(
        wheelRefs.current[colIndex],
        liveItemRefs.current[colIndex],
        parts[colIndex]
      );
    });
  };

  const syncWheels = useCallback(
    (parts: DurationParts, behavior: ScrollBehavior) => {
      columns.forEach((_, colIndex) => {
        const el = wheelRefs.current[colIndex];
        if (!el) {
          return;
        }
        const itemHeight = readItemHeight(el);
        el.scrollTo({ top: parts[colIndex] * itemHeight, behavior });
      });
    },
    [columns]
  );

  useEffect(() => {
    if (lastSyncedPartsRef.current && partsEqual(lastSyncedPartsRef.current, valueParts)) {
      return;
    }
    lastSyncedPartsRef.current = [valueParts[0], valueParts[1], valueParts[2]];
    indexRefs.current = [valueParts[0], valueParts[1], valueParts[2]];
    syncWheels(valueParts, 'auto');
    applyLiveForParts(valueParts);
  }, [valueParts, syncWheels, columns]);

  const emitParts = useCallback(
    (next: DurationParts) => {
      const clamped = clampAfterSnap(mode, next, maxSeconds);
      if (partsEqual(clamped, valuePartsRef.current)) {
        if (!partsEqual(clamped, next)) {
          lastSyncedPartsRef.current = clamped;
          syncWheels(clamped, scrollBehavior);
          applyLiveForParts(clamped);
        }
        return;
      }
      indexRefs.current = clamped;
      lastSyncedPartsRef.current = clamped;
      onCommitParts(clamped);
      syncWheels(clamped, scrollBehavior);
      applyLiveForParts(clamped);
    },
    [maxSeconds, mode, onCommitParts, scrollBehavior, syncWheels, columns]
  );

  const commitColumnIndex = useCallback(
    (colIndex: number, nextIndex: number) => {
      if (disabled) {
        return;
      }
      const max = columns[colIndex].max;
      const bounded = Math.min(max, Math.max(0, nextIndex));
      const current = valuePartsRef.current;
      const next: DurationParts = [current[0], current[1], current[2]];
      next[colIndex] = bounded;
      emitParts(next);
    },
    [columns, disabled, emitParts]
  );

  const commitFromWheelRef = useRef<(colIndex: number) => void>(() => {});
  commitFromWheelRef.current = (colIndex: number) => {
    if (disabled) {
      return;
    }
    const el = wheelRefs.current[colIndex];
    if (!el) {
      return;
    }
    const idx = indexFromScrollTop(
      el.scrollTop,
      readItemHeight(el),
      columns[colIndex].max
    );
    const current = valuePartsRef.current;
    const next: DurationParts = [current[0], current[1], current[2]];
    next[colIndex] = idx;
    emitParts(next);
  };

  const scheduleRafCommit = (colIndex: number): void => {
    cancelRafCommit(colIndex);
    rafCommitRef.current[colIndex] = requestAnimationFrame(() => {
      rafCommitRef.current[colIndex] = 0;
      commitFromWheelRef.current(colIndex);
    });
  };

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const supportsScrollend = hasScrollendSupport();
    wheelRefs.current.forEach((el, colIndex) => {
      if (!el) {
        return;
      }
      if (!supportsScrollend) {
        return;
      }
      const onEnd = (): void => {
        cancelRafCommit(colIndex);
        commitFromWheelRef.current(colIndex);
      };
      el.addEventListener('scrollend', onEnd);
      cleanups.push(() => el.removeEventListener('scrollend', onEnd));
    });
    return () => {
      rafCommitRef.current.forEach((_, colIndex) => cancelRafCommit(colIndex));
      cleanups.forEach((fn) => fn());
    };
  }, [columns, itemLists]);

  const handleScroll = (colIndex: number): void => {
    const el = wheelRefs.current[colIndex];
    if (!el) {
      return;
    }
    const idx = indexFromScrollTop(
      el.scrollTop,
      readItemHeight(el),
      columns[colIndex].max
    );
    if (idx === indexRefs.current[colIndex]) {
      return;
    }
    indexRefs.current[colIndex] = idx;
    liveItemRefs.current[colIndex] = applyLiveItem(
      el,
      liveItemRefs.current[colIndex],
      idx
    );
    if (!hasScrollendSupport()) {
      scheduleRafCommit(colIndex);
    }
  };

  const handlePointerDown = (colIndex: number): void => {
    const el = wheelRefs.current[colIndex];
    pointerStartTopRef.current[colIndex] = el?.scrollTop ?? 0;
    ignoreClickRef.current[colIndex] = false;
  };

  const handlePointerUp = (colIndex: number): void => {
    const el = wheelRefs.current[colIndex];
    cancelRafCommit(colIndex);
    commitFromWheelRef.current(colIndex);
    if (el) {
      ignoreClickRef.current[colIndex] = el.scrollTop !== pointerStartTopRef.current[colIndex];
    }
  };

  const handleOptionClick = (colIndex: number, nextIndex: number): void => {
    if (ignoreClickRef.current[colIndex]) {
      ignoreClickRef.current[colIndex] = false;
      return;
    }
    commitColumnIndex(colIndex, nextIndex);
  };

  const handleKeyDown = (colIndex: number, event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      commitColumnIndex(colIndex, valueParts[colIndex] + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      commitColumnIndex(colIndex, valueParts[colIndex] - 1);
    }
  };

  return (
    <div
      className="duration-scroll-picker"
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    >
      {columns.map((col, colIndex) => (
        <div key={col.id} className="duration-scroll-picker__column">
          <div className="duration-scroll-picker__selection" aria-hidden="true">
            <span className="duration-scroll-picker__suffix">{t(col.unitKey)}</span>
          </div>
          <div
            ref={(el) => {
              wheelRefs.current[colIndex] = el;
            }}
            className="duration-scroll-picker__wheel"
            role="listbox"
            aria-label={t(col.ariaKey)}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onScroll={() => handleScroll(colIndex)}
            onPointerDown={() => handlePointerDown(colIndex)}
            onPointerUp={() => handlePointerUp(colIndex)}
            onKeyDown={(event) => handleKeyDown(colIndex, event)}
          >
            {itemLists[colIndex].map((n) => (
              <div
                key={n}
                className="duration-scroll-picker__item"
                role="option"
                aria-selected={n === valueParts[colIndex]}
                onClick={() => handleOptionClick(colIndex, n)}
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
