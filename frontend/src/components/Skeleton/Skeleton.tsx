import './Skeleton.css';

interface SkeletonProps {
  /** Width (CSS value or number for px) */
  width?: string | number;
  /** Height (CSS value or number for px) */
  height?: string | number;
  /** Border radius variant */
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  /** Animation type */
  animation?: 'pulse' | 'wave' | 'none';
  /** Additional CSS class */
  className?: string;
}

/**
 * Skeleton placeholder for loading states.
 * 
 * @example
 * ```tsx
 * // Text skeleton
 * <Skeleton variant="text" width={200} />
 * 
 * // Avatar skeleton
 * <Skeleton variant="circular" width={48} height={48} />
 * 
 * // Card skeleton
 * <Skeleton variant="rounded" width="100%" height={120} />
 * ```
 */
export function Skeleton({
  width,
  height,
  variant = 'text',
  animation = 'pulse',
  className = '',
}: SkeletonProps) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  const classes = [
    'skeleton',
    `skeleton--${variant}`,
    animation !== 'none' && `skeleton--${animation}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes} style={style} />;
}

interface SkeletonTextProps {
  /** Number of lines */
  lines?: number;
  /** Width of last line (as percentage or CSS value) */
  lastLineWidth?: string;
  /** Gap between lines */
  gap?: 'sm' | 'md';
  /** Animation type */
  animation?: 'pulse' | 'wave' | 'none';
}

/**
 * Multiple line skeleton for text blocks.
 * 
 * @example
 * ```tsx
 * <SkeletonText lines={3} lastLineWidth="60%" />
 * ```
 */
export function SkeletonText({
  lines = 3,
  lastLineWidth = '80%',
  gap = 'sm',
  animation = 'pulse',
}: SkeletonTextProps) {
  return (
    <div className={`skeleton-text skeleton-text--gap-${gap}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? lastLineWidth : '100%'}
          animation={animation}
        />
      ))}
    </div>
  );
}

interface SkeletonAvatarProps {
  /** Size in pixels */
  size?: number;
  /** Animation type */
  animation?: 'pulse' | 'wave' | 'none';
}

/**
 * Circular skeleton for avatars.
 * 
 * @example
 * ```tsx
 * <SkeletonAvatar size={48} />
 * ```
 */
export function SkeletonAvatar({
  size = 40,
  animation = 'pulse',
}: SkeletonAvatarProps) {
  return (
    <Skeleton
      variant="circular"
      width={size}
      height={size}
      animation={animation}
    />
  );
}

interface SkeletonCardProps {
  /** Whether to show avatar */
  avatar?: boolean;
  /** Number of text lines */
  lines?: number;
  /** Additional CSS class */
  className?: string;
}

/**
 * Pre-built card skeleton with avatar and text.
 * 
 * @example
 * ```tsx
 * <SkeletonCard avatar lines={2} />
 * ```
 */
export function SkeletonCard({
  avatar = true,
  lines = 2,
  className = '',
}: SkeletonCardProps) {
  return (
    <div className={`skeleton-card ${className}`}>
      {avatar && (
        <SkeletonAvatar size={40} />
      )}
      <div className="skeleton-card-content">
        <SkeletonText lines={lines} lastLineWidth="60%" gap="sm" />
      </div>
    </div>
  );
}
