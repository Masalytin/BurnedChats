import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../../hooks/useTelegram';
import './BottomNavBar.css';

export interface BottomNavItem {
  id: string;
  icon: ReactNode;
  labelKey: string;
  badgeCount?: number;
}

interface BottomNavBarProps {
  items: BottomNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onReselect?: (id: string) => void;
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Presentational bottom navigation bar for top-level app sections.
 * Routing and visibility are controlled by the parent (see IMP-NAV-02).
 */
export function BottomNavBar({
  items,
  activeId,
  onSelect,
  onReselect,
}: BottomNavBarProps) {
  const { t } = useTranslation();
  const { selectionChanged } = useTelegram();

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );

  const pillStyle = {
    '--pill-index': activeIndex,
    '--pill-count': items.length,
  } as CSSProperties;

  const handleTabClick = (id: string) => {
    if (id === activeId) {
      onReselect?.(id);
      return;
    }

    try {
      selectionChanged();
    } catch {
      // Telegram haptic APIs throw on some WebViews; navigation must still proceed.
    }
    onSelect(id);
  };

  return (
    <nav className="bottom-nav" role="tablist">
      <div className="bottom-nav__pill" style={pillStyle} aria-hidden="true" />
      {items.map((item) => {
        const isActive = item.id === activeId;
        const showBadge = (item.badgeCount ?? 0) > 0;

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`bottom-nav__tab${isActive ? ' bottom-nav__tab--active' : ''}`}
            onClick={() => handleTabClick(item.id)}
          >
            <span className="bottom-nav__icon-wrap">
              <span className="bottom-nav__icon">{item.icon}</span>
              {showBadge && (
                <span className="bottom-nav__badge" key={item.badgeCount}>
                  {formatBadgeCount(item.badgeCount!)}
                </span>
              )}
            </span>
            <span className="bottom-nav__label">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
