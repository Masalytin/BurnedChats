import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
  children: ReactNode;
}

/**
 * Reusable button component with Telegram theme support
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
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

  return (
    <button
      className={classes}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <span className="button-spinner" />}
      {!isLoading && leftIcon && <span className="button-icon button-icon--left">{leftIcon}</span>}
      <span className="button-text">{children}</span>
      {!isLoading && rightIcon && <span className="button-icon button-icon--right">{rightIcon}</span>}
    </button>
  );
}


