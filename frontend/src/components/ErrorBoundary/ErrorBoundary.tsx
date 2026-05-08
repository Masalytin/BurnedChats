import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic error boundary with render-prop fallback (WalletChrome and local shells).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.fallback({
        error,
        reset: () => this.setState({ error: null }),
      });
    }
    return this.props.children;
  }
}
