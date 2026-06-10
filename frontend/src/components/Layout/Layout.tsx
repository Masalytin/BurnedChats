import type { ReactNode } from 'react';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
  /** Optional bottom navigation slot; safe-area bottom padding moves to the bar */
  bottomNav?: ReactNode;
  /** Chat screens: no main padding, no nested scroll container */
  fullBleed?: boolean;
}

/**
 * Main layout wrapper component
 */
export function Layout({ children, bottomNav, fullBleed }: LayoutProps) {
  const layoutClassName = [
    'layout',
    bottomNav ? 'layout--with-nav' : '',
    fullBleed ? 'layout--full-bleed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={layoutClassName}>
      <main className="layout-main">
        {children}
      </main>
      {bottomNav}
    </div>
  );
}


