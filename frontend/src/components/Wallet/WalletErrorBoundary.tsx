import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { debugLog } from '@/components/DebugPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function WalletChromeFallback({
  error: _error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      style={{
        padding: 'var(--bc-spacing-sm, 8px) var(--bc-spacing-md, 12px)',
        margin: 'var(--bc-spacing-xs, 4px)',
        borderRadius: 'var(--bc-radius-sm, 8px)',
        background: 'var(--bc-bg-elevated, #181c24)',
        border: '1px solid var(--bc-border-subtle, rgba(255,255,255,0.12))',
        maxWidth: '18rem',
      }}
    >
      <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('wallet.errorTitle')}</p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.22)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {t('wallet.errorRetry')}
      </button>
    </div>
  );
}

/**
 * Isolates WalletChrome crashes from the rest of {@link AppContent}.
 */
export function WalletErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => <WalletChromeFallback error={error} reset={reset} />}
      onError={(error, info) => debugLog('error', '[WalletChrome]', { error, info })}
    >
      {children}
    </ErrorBoundary>
  );
}
