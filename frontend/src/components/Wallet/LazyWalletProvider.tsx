import { lazy } from 'react';

/** Lazy wallet context — avoids eager TonConnect hook run until mounted (Telegram MA). */
export const LazyWalletProvider = lazy(() =>
  import('./WalletProvider').then((m) => ({ default: m.WalletProvider })),
);
