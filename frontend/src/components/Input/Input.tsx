import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import './Input.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * Text input component with Telegram theme support
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      fullWidth = true,
      className = '',
      id,
      ...props
    },
    ref
  ) {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
    const hasError = Boolean(error);

    return (
      <div className={`input-wrapper ${fullWidth ? 'input-wrapper--full-width' : ''} ${className}`}>
        {label && (
          <label htmlFor={inputId} className="input-label">
            {label}
          </label>
        )}
        <div className={`input-container ${hasError ? 'input-container--error' : ''}`}>
          {leftIcon && <span className="input-icon input-icon--left">{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            className="input-field"
            aria-invalid={hasError}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {rightIcon && <span className="input-icon input-icon--right">{rightIcon}</span>}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="input-error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="input-hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

