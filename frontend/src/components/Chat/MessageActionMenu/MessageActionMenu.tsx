import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MessageAction } from './types';
import './MessageActionMenu.css';

const MENU_EST_WIDTH = 220;
const MENU_EST_HEIGHT = 280;
const MARGIN = 8;
const APPEAR_MS = 140;

export interface MessageActionMenuProps {
  anchor: { x: number; y: number } | DOMRect;
  actions: MessageAction[];
  onClose: () => void;
  /** id of the message row element for `aria-labelledby` */
  labelledById?: string;
}

type MenuPos = { top: number; left: number };

function anchorPoint(anchor: MessageActionMenuProps['anchor']): { x: number; y: number } {
  if (typeof DOMRect !== 'undefined' && anchor instanceof DOMRect) {
    return { x: anchor.left, y: anchor.top };
  }
  const p = anchor as { x: number; y: number };
  return { x: p.x, y: p.y };
}

/**
 * Context menu for message actions. Positioned in the viewport with flip; closes on
 * outside click, Escape, and supports arrow/Enter keyboard navigation.
 */
export function MessageActionMenu({ anchor, actions, onClose, labelledById }: MessageActionMenuProps) {
  const idPrefix = useId().replace(/:/g, '');
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);
  const [position, setPosition] = useState<MenuPos | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  activeIndexRef.current = activeIndex;

  useLayoutEffect(() => {
    const p = anchorPoint(anchor);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = MENU_EST_WIDTH;
    const h = MENU_EST_HEIGHT;

    let left = p.x;
    let top = p.y;

    if (left + w + MARGIN > vw) {
      left = Math.max(MARGIN, vw - w - MARGIN);
    } else {
      left = Math.max(MARGIN, left);
    }
    if (left + w > vw - MARGIN) {
      left = vw - w - MARGIN;
    }

    if (top + h + MARGIN > vh) {
      top = Math.max(MARGIN, p.y - h - MARGIN);
    } else {
      top = Math.max(MARGIN, top);
    }
    if (top + h > vh - MARGIN) {
      top = vh - h - MARGIN;
    }
    if (top < MARGIN) top = MARGIN;

    setPosition({ top, left });
  }, [anchor]);

  useEffect(() => {
    setOpen(true);
  }, []);

  const getEnabledIndices = useCallback(
    () =>
      actions
        .map((a, i) => (!a.disabled ? i : -1))
        .filter((i): i is number => i >= 0),
    [actions],
  );

  useLayoutEffect(() => {
    const enabled = getEnabledIndices();
    if (enabled.length === 0) {
      return;
    }
    setActiveIndex((prev) => (enabled.includes(prev) ? prev : enabled[0]!));
  }, [getEnabledIndices, actions]);

  const focusMenu = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.focus();
    });
  }, []);

  useLayoutEffect(() => {
    focusMenu();
  }, [focusMenu]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onDocKey, true);
    };
  }, [onClose]);

  const onItemClick = useCallback(
    (action: MessageAction) => {
      if (action.disabled) return;
      action.onClick();
      onClose();
    },
    [onClose],
  );

  const getItemDomId = useCallback(
    (index: number) => `ma-${idPrefix}-item-${index}`,
    [idPrefix],
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!listRef.current) {
        return;
      }
      const enabled = getEnabledIndices();
      if (enabled.length === 0) {
        return;
      }
      const pos = (idx: number) => enabled.indexOf(idx);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((cur) => {
          const p = pos(cur);
          const nextP = p < 0 ? 0 : (p + 1) % enabled.length;
          return enabled[nextP] ?? cur;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((cur) => {
          const p = pos(cur);
          const nextP = p <= 0 ? enabled.length - 1 : p - 1;
          return enabled[nextP] ?? cur;
        });
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(enabled[0]!);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(enabled[enabled.length - 1]!);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const i = activeIndexRef.current;
        const act = actions[i];
        if (act && !act.disabled) {
          act.onClick();
          onClose();
        }
      }
    },
    [actions, getEnabledIndices, onClose],
  );

  if (typeof document === 'undefined' || !position) {
    return null;
  }

  const activeItemId = getItemDomId(activeIndex);
  const menuId = `ma-${idPrefix}-list`;

  const menu = (
    <div
      className="message-action-menu-backdrop"
      role="presentation"
      aria-hidden
    >
      <div
        ref={listRef}
        id={menuId}
        className={`message-action-menu${open ? ' message-action-menu--open' : ''}`}
        style={{ top: position.top, left: position.left }}
        role="menu"
        aria-labelledby={labelledById}
        aria-activedescendant={activeItemId}
        data-testid="message-action-menu"
        tabIndex={0}
        onKeyDown={handleMenuKeyDown}
      >
        {actions.map((a, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={a.id + String(i)}
              id={getItemDomId(i)}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={
                'message-action-menu__item' +
                (a.variant === 'destructive' ? ' message-action-menu__item--destructive' : '') +
                (a.disabled ? ' message-action-menu__item--disabled' : '') +
                (isActive ? ' message-action-menu__item--active' : '')
              }
              disabled={a.disabled}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onItemClick(a)}
            >
              <span className="message-action-menu__icon" aria-hidden>
                {a.icon}
              </span>
              <span className="message-action-menu__label">{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="message-action-menu-portal"
      style={{ ['--ma-menu-appear' as string]: `${APPEAR_MS}ms` }}
    >
      {menu}
    </div>,
    document.body,
  );
}
