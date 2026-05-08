import { lazy } from 'react';

/** Lazy wallet shell — avoids eager TonConnect hook run until mounted (Telegram MA). */
export const LazyWalletChrome = lazy(() => import('./WalletDrawer'));
