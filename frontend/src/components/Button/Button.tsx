import type { ButtonHTMLAttributes, ReactNode, MouseEvent } from 'react';
import { useHaptics } from '../../hooks/useHaptics';
import './Button.css';

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Disable haptic feedback */
  disableHaptics?: boolean;
  children: ReactNode;
}

/**
 * Reusable button component with Telegram theme support and haptic feedback
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  leftIcon,
  rightIcon,
  disableHaptics = false,
  children,
  disabled,
  className = '',
  onClick,
  ...props
}: ButtonProps) {
  const haptics = useHaptics();

  const classes = [
    'button',
    `button--${variant}`,
    `button--${size}`,
    fullWidth && 'button--full-width',
    isLoading && 'button--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!disableHaptics && !disabled && !isLoading) {
      // Use different haptic styles based on button variant
      if (variant === 'destructive') {
        haptics.impact('heavy');
      } else {
        haptics.buttonClick();
      }
    }
    onClick?.(e);
  };

  return (
    <button
      className={classes}
      disabled={disabled || isLoading}
      onClick={handleClick}
      {...props}
    >
      {isLoading && <span className="button-spinner" />}
      {!isLoading && leftIcon && <span className="button-icon button-icon--left">{leftIcon}</span>}
      <span className="button-text">{children}</span>
      {!isLoading && rightIcon && <span className="button-icon button-icon--right">{rightIcon}</span>}
    </button>
  );
}


