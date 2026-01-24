import type { ReactNode } from 'react';
import './LoadingOverlay.css';

interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  isLoading?: boolean;
  /** Loading message to display */
  message?: string;
  /** Whether to use a transparent/dim background */
  transparent?: boolean;
  /** Content to wrap (if provided, overlay is positioned absolute) */
  children?: ReactNode;
  /** Custom spinner element */
  spinner?: ReactNode;
  /** Size of the default spinner */
  spinnerSize?: 'sm' | 'md' | 'lg';
}

/**
 * Loading overlay component.
 * 
 * Can be used in two modes:
 * 1. Full-screen overlay: No children provided
 * 2. Container overlay: Wrap content to show loading state over it
 * 
 * @example
 * ```tsx
 * // Full-screen loading
 * {isLoading && <LoadingOverlay message="Loading..." />}
 * 
 * // Container loading
 * <LoadingOverlay isLoading={isLoading} message="Fetching data...">
 *   <MyContent />
 * </LoadingOverlay>
 * ```
 */
export function LoadingOverlay({
  isLoading = true,
  message,
  transparent = false,
  children,
  spinner,
  spinnerSize = 'md',
}: LoadingOverlayProps) {
  const spinnerElement = spinner || (
    <div className={`loading-overlay-spinner loading-overlay-spinner--${spinnerSize}`}>
      <div className="loading-overlay-spinner-circle" />
    </div>
  );

  // If children provided, render as container with overlay
  if (children !== undefined) {
    return (
      <div className="loading-overlay-container">
        {children}
        {isLoading && (
          <div 
            className={`loading-overlay loading-overlay--absolute ${transparent ? 'loading-overlay--transparent' : ''}`}
          >
            <div className="loading-overlay-content">
              {spinnerElement}
              {message && <p className="loading-overlay-message">{message}</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full-screen overlay
  if (!isLoading) return null;

  return (
    <div className={`loading-overlay ${transparent ? 'loading-overlay--transparent' : ''}`}>
      <div className="loading-overlay-content">
        {spinnerElement}
        {message && <p className="loading-overlay-message">{message}</p>}
      </div>
    </div>
  );
}
