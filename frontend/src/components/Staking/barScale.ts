import type { CSSProperties } from 'react';

/** Maps 0–100 progress to a compositor-friendly scaleX custom property. */
export function barScaleStyle(percent: number): CSSProperties {
  const scale = Math.min(100, Math.max(0, percent)) / 100;
  return { '--bar-scale': String(scale) } as CSSProperties;
}
