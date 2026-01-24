import { useEffect, useState } from 'react';
import { SuccessIcon, ErrorIcon, WarningIcon, InfoIcon, CloseIcon } from '../../icons';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
  dismissible?: boolean;
}

interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
}

/**
 * Individual toast notification component.
 */
export function Toast({
  id,
  type,
  message,
  title,
  duration = 4000,
  dismissible = true,
  onDismiss,
}: ToastProps) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleDismiss = () => {
    setIsLeaving(true);
    // Wait for animation to complete
    setTimeout(() => {
      onDismiss(id);
    }, 200);
  };

  const icon = {
    success: <SuccessIcon size={20} />,
    error: <ErrorIcon size={20} />,
    warning: <WarningIcon size={20} />,
    info: <InfoIcon size={20} />,
  }[type];

  return (
    <div 
      className={`toast toast--${type} ${isLeaving ? 'toast--leaving' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="toast-icon">{icon}</div>
      <div className="toast-content">
        {title && <p className="toast-title">{title}</p>}
        <p className="toast-message">{message}</p>
      </div>
      {dismissible && (
        <button 
          className="toast-dismiss" 
          onClick={handleDismiss}
          aria-label="Dismiss notification"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  position?: 'top' | 'bottom';
}

/**
 * Container for displaying multiple toasts.
 */
export function ToastContainer({ 
  toasts, 
  onDismiss,
  position = 'bottom',
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className={`toast-container toast-container--${position}`}>
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
