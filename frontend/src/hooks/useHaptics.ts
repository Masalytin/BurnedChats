import { useCallback } from 'react';
import WebApp from '@twa-dev/sdk';

/**
 * Impact feedback styles
 * - light: subtle tap feedback (e.g., selection change)
 * - medium: moderate feedback (e.g., button press)
 * - heavy: strong feedback (e.g., confirmation actions)
 * - rigid: short stiff feedback
 * - soft: soft flexible feedback
 */
export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

/**
 * Notification feedback types
 * - success: positive action completed
 * - warning: attention needed
 * - error: action failed
 */
export type NotificationType = 'success' | 'warning' | 'error';

interface UseHapticsReturn {
  /** Check if haptics are available */
  isAvailable: boolean;
  /** Trigger impact feedback (for UI interactions) */
  impact: (style?: ImpactStyle) => void;
  /** Trigger notification feedback (for action results) */
  notification: (type: NotificationType) => void;
  /** Trigger selection change feedback (for list selections) */
  selectionChanged: () => void;
  /** Button click feedback (light impact) */
  buttonClick: () => void;
  /** Success action feedback */
  success: () => void;
  /** Error action feedback */
  error: () => void;
  /** Warning feedback */
  warning: () => void;
  /** Heavy impact for destructive actions */
  destructive: () => void;
}

/**
 * Hook for Telegram Mini App haptic feedback.
 * 
 * Provides simple methods for common haptic feedback patterns.
 * Automatically checks if running in Telegram and gracefully
 * degrades when haptics are not available.
 * 
 * @example
 * ```tsx
 * function MyButton() {
 *   const haptics = useHaptics();
 * 
 *   const handleClick = () => {
 *     haptics.buttonClick();
 *     // ... handle click
 *   };
 * 
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useHaptics(): UseHapticsReturn {
  // Check if running in Telegram (haptics only available there)
  const isAvailable = Boolean(WebApp.initData && WebApp.initData.length > 0);

  const impact = useCallback((style: ImpactStyle = 'medium') => {
    if (isAvailable) {
      try {
        WebApp.HapticFeedback.impactOccurred(style);
      } catch (e) {
        // Silently fail if haptics unavailable
      }
    }
  }, [isAvailable]);

  const notification = useCallback((type: NotificationType) => {
    if (isAvailable) {
      try {
        WebApp.HapticFeedback.notificationOccurred(type);
      } catch (e) {
        // Silently fail if haptics unavailable
      }
    }
  }, [isAvailable]);

  const selectionChanged = useCallback(() => {
    if (isAvailable) {
      try {
        WebApp.HapticFeedback.selectionChanged();
      } catch (e) {
        // Silently fail if haptics unavailable
      }
    }
  }, [isAvailable]);

  // Convenience methods
  const buttonClick = useCallback(() => impact('light'), [impact]);
  const success = useCallback(() => notification('success'), [notification]);
  const error = useCallback(() => notification('error'), [notification]);
  const warning = useCallback(() => notification('warning'), [notification]);
  const destructive = useCallback(() => impact('heavy'), [impact]);

  return {
    isAvailable,
    impact,
    notification,
    selectionChanged,
    buttonClick,
    success,
    error,
    warning,
    destructive,
  };
}
