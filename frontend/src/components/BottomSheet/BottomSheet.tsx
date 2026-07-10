import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';

import { useBackButton } from '@/hooks/useBackButton';

import './BottomSheet.css';

export interface BottomSheetProps {
  /** Whether the sheet is visible. */
  open: boolean;
  /** Called when the user dismisses the sheet (backdrop, Escape, BackButton). */
  onClose: () => void;
  /** ID of the visible title element for `aria-labelledby`. */
  ariaLabelledBy: string;
  children: ReactNode;
  /**
   * Pause Escape, backdrop click, focus-trap, and BackButton for nested layers.
   * Parent sheets set this when a child overlay is open.
   */
  suspended?: boolean;
  /** Backdrop element class (consumer styling). */
  backdropClassName?: string;
  /** Panel element class (consumer styling). */
  panelClassName?: string;
  /** Apply slide-up animation and `data-reduced-motion` on the panel. */
  reducedMotionAware?: boolean;
  /** Focus target when the sheet opens (typically the close button). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Whether to move focus to `initialFocusRef` when opened. Defaults to `!suspended`. */
  focusOnOpen?: boolean;
  /** Override BackButton visibility. Defaults to `open && !suspended`. */
  backButtonVisible?: boolean;
  /** Override BackButton handler. Defaults to `onClose`. */
  onBack?: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Presentational bottom-sheet primitive: focus-trap, Escape, backdrop, BackButton,
 * optional reduced-motion animation. Content and visual styling are supplied by children.
 */
export function BottomSheet({
  open,
  onClose,
  ariaLabelledBy,
  children,
  suspended = false,
  backdropClassName,
  panelClassName,
  reducedMotionAware = false,
  initialFocusRef,
  focusOnOpen,
  backButtonVisible,
  onBack,
}: BottomSheetProps) {
  const prefersReducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldFocusOnOpen = focusOnOpen ?? !suspended;
  const isBackButtonVisible = backButtonVisible ?? (open && !suspended);
  const handleBack = onBack ?? onClose;

  useBackButton({
    visible: isBackButtonVisible,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!open || suspended) return;

    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, suspended]);

  useEffect(() => {
    if (open && shouldFocusOnOpen) {
      initialFocusRef?.current?.focus();
    }
  }, [open, shouldFocusOnOpen, initialFocusRef]);

  useEffect(() => {
    if (!open || suspended) return;
    const root = panelRef.current;
    if (!root) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const list = Array.from(nodes).filter((el) => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', handleKey);
    return () => root.removeEventListener('keydown', handleKey);
  }, [open, suspended]);

  if (!open) {
    return null;
  }

  const backdropClass = ['bottom-sheet-backdrop', backdropClassName]
    .filter(Boolean)
    .join(' ');
  const panelClass = ['bottom-sheet-panel', panelClassName].filter(Boolean).join(' ');

  return (
    <div
      className={backdropClass}
      role="presentation"
      onClick={(e) => {
        if (!suspended && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        data-reduced-motion={
          reducedMotionAware ? (prefersReducedMotion ? 'true' : 'false') : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
