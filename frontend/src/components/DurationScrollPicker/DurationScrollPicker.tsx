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

  const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

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
    indexRefs.current = [valueParts[0], valueParts[1], valueParts[2]];
    syncWheels(valueParts, 'auto');
  }, [valueParts, syncWheels]);

  const emitParts = useCallback(
    (next: DurationParts) => {
      const clamped = clampAfterSnap(mode, next, maxSeconds);
      if (partsEqual(clamped, valuePartsRef.current)) {
        if (!partsEqual(clamped, next)) {
          syncWheels(clamped, scrollBehavior);
        }
        return;
      }
      indexRefs.current = clamped;
      onCommitParts(clamped);
      syncWheels(clamped, scrollBehavior);
    },
    [maxSeconds, mode, onCommitParts, scrollBehavior, syncWheels]
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

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    wheelRefs.current.forEach((el, colIndex) => {
      if (!el) {
        return;
      }
      const onEnd = (): void => {
        commitFromWheelRef.current(colIndex);
      };
      el.addEventListener('scrollend', onEnd);
      cleanups.push(() => el.removeEventListener('scrollend', onEnd));
    });
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [columns, itemLists]);

  const handleScroll = (colIndex: number): void => {
    const el = wheelRefs.current[colIndex];
    if (!el) {
      return;
    }
    indexRefs.current[colIndex] = indexFromScrollTop(
      el.scrollTop,
      readItemHeight(el),
      columns[colIndex].max
    );
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
            onPointerUp={() => commitFromWheelRef.current(colIndex)}
            onKeyDown={(event) => handleKeyDown(colIndex, event)}
          >
            {itemLists[colIndex].map((n) => (
              <div
                key={n}
                className="duration-scroll-picker__item"
                role="option"
                aria-selected={n === valueParts[colIndex]}
                onClick={() => commitColumnIndex(colIndex, n)}
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
