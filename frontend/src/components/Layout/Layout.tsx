import type { ReactNode } from 'react';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
  /** Optional bottom navigation slot; safe-area bottom padding moves to the bar */
  bottomNav?: ReactNode;
}

/**
 * Main layout wrapper component
 */
export function Layout({ children, bottomNav }: LayoutProps) {
  const layoutClassName = bottomNav ? 'layout layout--with-nav' : 'layout';

  return (
    <div className={layoutClassName}>
      <main className="layout-main">
        {children}
      </main>
      {bottomNav}
    </div>
  );
}


