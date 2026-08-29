export interface CoachmarkHoleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CoachmarkSize {
  width: number;
  height: number;
}

export interface CoachmarkViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CoachmarkTooltipPos {
  top: number;
  left: number;
  maxHeight: number;
}

/** Matches `--bc-spacing-2xs` (12px). */
export const COACHMARK_GAP_PX = 12;

export const COACHMARK_MARGIN_PX = 8;

/** Holes in this band keep the tooltip below (search). Mid-page holes prefer above. */
export const COACHMARK_TOP_BAND = 0.28;

export function readCoachmarkViewport(): CoachmarkViewport {
  const visual = window.visualViewport;
  if (visual) {
    return {
      top: visual.offsetTop,
      left: visual.offsetLeft,
      width: visual.width,
      height: visual.height,
    };
  }
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clampAxis(start: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(start, min), max);
}

/**
 * Positions the tooltip next to the spotlight hole without covering it.
 * Mid-page targets (Create Room) flip above when both sides fit so the
 * empty-state CTA stays visible. If the tooltip is taller than both
 * slabs, maxHeight shrinks to the chosen slab — Next stays reachable
 * via the tooltip's own scroll, not by sliding over the hole.
 */
export function placeCoachmarkTooltip(
  hole: CoachmarkHoleRect,
  tooltip: CoachmarkSize,
  viewport: CoachmarkViewport,
  gap = COACHMARK_GAP_PX,
  margin = COACHMARK_MARGIN_PX,
): CoachmarkTooltipPos {
  const vpBottom = viewport.top + viewport.height;
  const vpRight = viewport.left + viewport.width;
  const spaceBelow = vpBottom - (hole.top + hole.height) - gap - margin;
  const spaceAbove = hole.top - viewport.top - gap - margin;
  const inTopBand =
    hole.top - viewport.top <= viewport.height * COACHMARK_TOP_BAND;

  const canFitBelow = tooltip.height > 0 && tooltip.height <= spaceBelow;
  const canFitAbove = tooltip.height > 0 && tooltip.height <= spaceAbove;

  let placeBelow: boolean;
  if (canFitBelow && canFitAbove) {
    placeBelow = inTopBand;
  } else if (canFitBelow) {
    placeBelow = true;
  } else if (canFitAbove) {
    placeBelow = false;
  } else {
    placeBelow = spaceBelow >= spaceAbove;
  }

  const slab = Math.max(0, placeBelow ? spaceBelow : spaceAbove);
  const maxHeight =
    tooltip.height > 0 ? Math.max(1, Math.min(tooltip.height, slab || 1)) : slab;
  const usedHeight = tooltip.height > 0 ? Math.min(tooltip.height, maxHeight) : 0;

  const top = placeBelow
    ? hole.top + hole.height + gap
    : hole.top - gap - (usedHeight || tooltip.height);

  const left = clampAxis(
    hole.left,
    viewport.left + margin,
    vpRight - margin - tooltip.width,
  );

  return { top, left, maxHeight };
}
