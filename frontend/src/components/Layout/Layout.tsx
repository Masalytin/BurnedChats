import type { ReactNode } from 'react';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

/**
 * Main layout wrapper component
 */
export function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <main className="layout-main">
        {children}
      </main>
    </div>
  );
}


