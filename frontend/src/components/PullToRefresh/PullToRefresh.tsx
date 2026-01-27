import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import './PullToRefresh.css';

interface PullToRefreshProps {
  /** Content to render inside the pull-to-refresh container */
  children: ReactNode;
  /** Callback when refresh is triggered */
  onRefresh: () => void | Promise<void>;
  /** Whether refresh is currently in progress */
  isRefreshing?: boolean;
  /** Minimum pull distance to trigger refresh (in pixels) */
  threshold?: number;
  /** Maximum pull distance (in pixels) */
  maxPull?: number;
  /** Resistance factor (0-1, lower = more resistance) */
  resistance?: number;
  /** Custom loading indicator */
  loadingIndicator?: ReactNode;
  /** Whether pull-to-refresh is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

/** Pull state */
type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

/**
 * Pull-to-refresh component for mobile touch interactions (4.6.12).
 * 
 * @example
 * ```tsx
 * <PullToRefresh
 *   onRefresh={async () => {
 *     await fetchSessions();
 *   }}
 *   isRefreshing={isLoading}
 * >
 *   <SessionList sessions={sessions} />
 * </PullToRefresh>
 * ```
 */
export function PullToRefresh({
  children,
  onRefresh,
  isRefreshing = false,
  threshold = 60,
  maxPull = 120,
  resistance = 0.5,
  loadingIndicator,
  disabled = false,
  className = '',
}: PullToRefreshProps) {
  const [pullState, setPullState] = useState<PullState>('idle');
  const [pullDistance, setPullDistance] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isPullingRef = useRef(false);

  /**
   * Check if element is scrolled to top
   */
  const isScrolledToTop = useCallback((): boolean => {
    if (!containerRef.current) return true;
    return containerRef.current.scrollTop <= 0;
  }, []);

  /**
   * Handle touch start
   */
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing) return;
    
    // Only start if scrolled to top
    if (!isScrolledToTop()) return;

    startYRef.current = e.touches[0].clientY;
    currentYRef.current = e.touches[0].clientY;
    isPullingRef.current = false;
  }, [disabled, isRefreshing, isScrolledToTop]);

  /**
   * Handle touch move
   */
  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing) return;
    if (startYRef.current === 0) return;

    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;

    // Only allow pulling down
    if (deltaY <= 0) {
      if (isPullingRef.current) {
        setPullDistance(0);
        setPullState('idle');
        isPullingRef.current = false;
      }
      return;
    }

    // Check if we should start pulling (scrolled to top)
    if (!isPullingRef.current) {
      if (!isScrolledToTop()) return;
      isPullingRef.current = true;
      startYRef.current = currentY; // Reset start position
    }

    // Prevent default scroll behavior while pulling
    e.preventDefault();

    currentYRef.current = currentY;
    
    // Calculate pull distance with resistance
    const rawDistance = currentY - startYRef.current;
    const resistedDistance = Math.min(
      maxPull,
      rawDistance * resistance
    );
    
    setPullDistance(resistedDistance);
    
    // Update state based on distance
    if (resistedDistance >= threshold) {
      setPullState('ready');
    } else {
      setPullState('pulling');
    }
  }, [disabled, isRefreshing, isScrolledToTop, maxPull, resistance, threshold]);

  /**
   * Handle touch end
   */
  const handleTouchEnd = useCallback(() => {
    if (disabled || isRefreshing) return;
    if (!isPullingRef.current) return;

    // Check if threshold was reached
    if (pullDistance >= threshold) {
      setPullState('refreshing');
      // Keep some pull distance while refreshing
      setPullDistance(threshold * 0.6);
      
      // Trigger refresh
      const result = onRefresh();
      if (result instanceof Promise) {
        result.finally(() => {
          setPullDistance(0);
          setPullState('idle');
        });
      }
    } else {
      // Reset if not enough pull
      setPullDistance(0);
      setPullState('idle');
    }

    // Reset refs
    startYRef.current = 0;
    currentYRef.current = 0;
    isPullingRef.current = false;
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh]);

  /**
   * Handle touch cancel
   */
  const handleTouchCancel = useCallback(() => {
    setPullDistance(0);
    setPullState('idle');
    startYRef.current = 0;
    currentYRef.current = 0;
    isPullingRef.current = false;
  }, []);

  // Update state when external isRefreshing changes
  const effectivePullState = isRefreshing ? 'refreshing' : pullState;
  const effectivePullDistance = isRefreshing ? threshold * 0.6 : pullDistance;

  // Calculate indicator progress (0-1)
  const progress = Math.min(1, pullDistance / threshold);

  return (
    <div
      ref={containerRef}
      className={`pull-to-refresh ${className}`.trim()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Pull indicator */}
      <div 
        className={`pull-indicator pull-indicator--${effectivePullState}`}
        style={{ 
          height: effectivePullDistance,
          opacity: progress,
        }}
      >
        {loadingIndicator || (
          <div className="pull-indicator-content">
            {effectivePullState === 'refreshing' ? (
              <div className="pull-spinner" />
            ) : (
              <div 
                className="pull-arrow"
                style={{ 
                  transform: `rotate(${effectivePullState === 'ready' ? 180 : 0}deg)`,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </div>
            )}
            <span className="pull-text">
              {effectivePullState === 'refreshing'
                ? 'Refreshing...'
                : effectivePullState === 'ready'
                  ? 'Release to refresh'
                  : 'Pull to refresh'}
            </span>
          </div>
        )}
      </div>

      {/* Content wrapper */}
      <div 
        className="pull-content"
        style={{ 
          transform: effectivePullDistance > 0 
            ? `translateY(${effectivePullDistance}px)` 
            : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
