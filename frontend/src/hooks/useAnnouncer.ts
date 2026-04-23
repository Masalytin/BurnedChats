import { useCallback, useRef } from 'react';

/**
 * Aria-live region hook for one-off screen reader announcements.
 */
export function useAnnouncer() {
  const elRef = useRef<HTMLDivElement | null>(null);

  const announce = useCallback((text: string, politeness: 'polite' | 'assertive' = 'polite') => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    el.setAttribute('aria-live', politeness);
    el.textContent = '';
    const run = () => {
      el.textContent = text;
    };
    requestAnimationFrame(run);
  }, []);

  return { announce, announcerRef: elRef };
}
