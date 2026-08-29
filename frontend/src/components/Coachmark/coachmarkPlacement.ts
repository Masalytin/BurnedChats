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

/** Matches `--bc-spacing-2xs` (12px). */
export const COACHMARK_GAP_PX = 12;

export const COACHMARK_MARGIN_PX = 8;

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

/**
 * Positions the tooltip next to the spotlight hole, flipping above when
 * there is not enough room below, then clamping into the visual viewport.
 * Overlay still captures pointer events — the tooltip must stay reachable
 * without scrolling the page.
 */
export function placeCoachmarkTooltip(
  hole: CoachmarkHoleRect,
  tooltip: CoachmarkSize,
  viewport: CoachmarkViewport,
  gap = COACHMARK_GAP_PX,
  margin = COACHMARK_MARGIN_PX,
): { top: number; left: number } {
  const vpBottom = viewport.top + viewport.height;
  const vpRight = viewport.left + viewport.width;
  const spaceBelow = vpBottom - (hole.top + hole.height) - gap - margin;
  const spaceAbove = hole.top - viewport.top - gap - margin;

  let top: number;
  if (tooltip.height <= spaceBelow) {
    top = hole.top + hole.height + gap;
  } else if (tooltip.height <= spaceAbove) {
    top = hole.top - gap - tooltip.height;
  } else if (spaceAbove > spaceBelow) {
    top = hole.top - gap - tooltip.height;
  } else {
    top = hole.top + hole.height + gap;
  }

  const minTop = viewport.top + margin;
  const maxTop = vpBottom - margin - tooltip.height;
  if (maxTop < minTop) {
    top = minTop;
  } else {
    top = Math.min(Math.max(top, minTop), maxTop);
  }

  let left = hole.left;
  const minLeft = viewport.left + margin;
  const maxLeft = vpRight - margin - tooltip.width;
  if (maxLeft < minLeft) {
    left = minLeft;
  } else {
    left = Math.min(Math.max(left, minLeft), maxLeft);
  }

  return { top, left };
}
