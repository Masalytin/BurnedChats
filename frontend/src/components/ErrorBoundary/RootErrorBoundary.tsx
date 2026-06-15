import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import i18n from '@/i18n';
import styles from './RootErrorBoundary.module.css';

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

function RootErrorFallback({
  error,
  onClearError,
}: {
  error: Error;
  onClearError: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const showStack = import.meta.env.DEV;

  const copyPayload = (): string =>
    JSON.stringify(
      {
        message: error.message,
        stack: error.stack,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
      },
      null,
      2,
    );

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyPayload());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const handleReport = (): void => {
    const subject = encodeURIComponent('BurnedChats crash report');
    const body = encodeURIComponent(copyPayload());
    window.location.href = `mailto:support@burnedchats.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className={styles.root} role="alert">
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <AlertTriangle size={36} strokeWidth={2} />
        </div>
        <h1 className={styles.title}>{i18n.t('errors.rootTitle')}</h1>
        <p className={styles.message}>{i18n.t('errors.rootMessage')}</p>
        {showStack && error.stack ? (
          <pre className={styles.stack}>{error.stack}</pre>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={() => window.location.reload()}>
            {i18n.t('errors.reload')}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={() => void handleCopy()}>
            {copied ? i18n.t('errors.copied') : i18n.t('errors.copyDebugInfo')}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={handleReport}>
            {i18n.t('errors.report')}
          </button>
          {showStack ? (
            <button type="button" className={styles.ghostBtn} onClick={onClearError}>
              {i18n.t('errors.dismiss')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Top-level boundary around {@link AppRouter}: reload-first UX + optional dev dismiss.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <RootErrorFallback
          error={error}
          onClearError={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
