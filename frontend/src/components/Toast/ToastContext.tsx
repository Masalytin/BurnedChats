import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import { ToastContainer, type ToastData, type ToastType } from './Toast';

interface ToastOptions {
  /** Toast title */
  title?: string;
  /** Duration in ms (0 = persistent) */
  duration?: number;
  /** Can be dismissed by user */
  dismissible?: boolean;
}

interface ToastContextValue {
  /** Show a toast notification */
  toast: (type: ToastType, message: string, options?: ToastOptions) => string;
  /** Show success toast */
  success: (message: string, options?: ToastOptions) => string;
  /** Show error toast */
  error: (message: string, options?: ToastOptions) => string;
  /** Show warning toast */
  warning: (message: string, options?: ToastOptions) => string;
  /** Show info toast */
  info: (message: string, options?: ToastOptions) => string;
  /** Dismiss a specific toast */
  dismiss: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;
const generateId = () => `toast-${++toastIdCounter}-${Date.now()}`;

interface ToastProviderProps {
  children: ReactNode;
  /** Toast container position */
  position?: 'top' | 'bottom';
  /** Maximum number of toasts to show */
  maxToasts?: number;
}

/**
 * Toast provider component.
 * 
 * Wrap your app with this to enable toast notifications.
 * 
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ToastProvider position="bottom">
 *       <MyApp />
 *     </ToastProvider>
 *   );
 * }
 * ```
 */
export function ToastProvider({ 
  children, 
  position = 'bottom',
  maxToasts = 5,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const toast = useCallback((
    type: ToastType,
    message: string,
    options: ToastOptions = {}
  ): string => {
    const id = generateId();
    const newToast: ToastData = {
      id,
      type,
      message,
      title: options.title,
      duration: options.duration ?? 4000,
      dismissible: options.dismissible ?? true,
    };

    setToasts((prev) => {
      // Limit number of toasts
      const updated = [...prev, newToast];
      if (updated.length > maxToasts) {
        return updated.slice(-maxToasts);
      }
      return updated;
    });

    return id;
  }, [maxToasts]);

  const success = useCallback((message: string, options?: ToastOptions) => 
    toast('success', message, options), [toast]);
    
  const error = useCallback((message: string, options?: ToastOptions) => 
    toast('error', message, options), [toast]);
    
  const warning = useCallback((message: string, options?: ToastOptions) => 
    toast('warning', message, options), [toast]);
    
  const info = useCallback((message: string, options?: ToastOptions) => 
    toast('info', message, options), [toast]);

  const value: ToastContextValue = {
    toast,
    success,
    error,
    warning,
    info,
    dismiss,
    dismissAll,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer 
        toasts={toasts} 
        onDismiss={dismiss} 
        position={position}
      />
    </ToastContext.Provider>
  );
}

/**
 * Hook to use toast notifications.
 * 
 * Must be used within a ToastProvider.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const toast = useToast();
 * 
 *   const handleSuccess = () => {
 *     toast.success('Operation completed!');
 *   };
 * 
 *   const handleError = (err: Error) => {
 *     toast.error(err.message, { title: 'Error' });
 *   };
 * 
 *   return <button onClick={handleSuccess}>Save</button>;
 * }
 * ```
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  
  return context;
}
