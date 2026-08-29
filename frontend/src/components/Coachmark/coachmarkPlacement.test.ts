import { describe, expect, it } from 'vitest';

import {
  COACHMARK_GAP_PX,
  COACHMARK_MARGIN_PX,
  placeCoachmarkTooltip,
} from './coachmarkPlacement';

const VIEWPORT = { top: 0, left: 0, width: 360, height: 480 };

describe('placeCoachmarkTooltip', () => {
  it('places the tooltip below the hole when there is room', () => {
    const hole = { top: 80, left: 16, width: 120, height: 40 };
    const tooltip = { width: 280, height: 160 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.top).toBe(hole.top + hole.height + COACHMARK_GAP_PX);
    expect(pos.left).toBe(hole.left);
    expect(pos.top + tooltip.height).toBeLessThanOrEqual(
      VIEWPORT.height - COACHMARK_MARGIN_PX,
    );
  });

  it('flips the tooltip above the hole when placing below would overflow', () => {
    const hole = { top: 400, left: 16, width: 120, height: 40 };
    const tooltip = { width: 280, height: 160 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.top).toBe(hole.top - COACHMARK_GAP_PX - tooltip.height);
    expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT.top + COACHMARK_MARGIN_PX);
    expect(pos.top + tooltip.height).toBeLessThanOrEqual(
      VIEWPORT.height - COACHMARK_MARGIN_PX,
    );
  });

  it('places a mid-page create-room hole tooltip above so it does not cover the empty-state CTA', () => {
    const viewport = { top: 0, left: 0, width: 360, height: 640 };
    const hole = { top: 300, left: 200, width: 120, height: 36 };
    const tooltip = { width: 280, height: 260 };

    const pos = placeCoachmarkTooltip(hole, tooltip, viewport);

    expect(pos.top + tooltip.height).toBeLessThanOrEqual(
      hole.top - COACHMARK_GAP_PX,
    );
    expect(pos.top).toBeGreaterThanOrEqual(viewport.top + COACHMARK_MARGIN_PX);
  });

  it('does not slide a too-tall tooltip on top of the hole', () => {
    const hole = { top: 200, left: 16, width: 120, height: 40 };
    const tooltip = { width: 280, height: 400 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);
    const usedHeight = pos.maxHeight ?? tooltip.height;
    const tooltipBottom = pos.top + usedHeight;
    const overlapsHole =
      pos.top < hole.top + hole.height && tooltipBottom > hole.top;

    expect(overlapsHole).toBe(false);
    expect(pos.maxHeight).toBeLessThan(tooltip.height);
  });

  it('shrinks a tall tooltip into the larger slab so Next stays in the viewport', () => {
    const hole = { top: 80, left: 16, width: 328, height: 280 };
    const tooltip = { width: 280, height: 220 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);
    const usedHeight = pos.maxHeight;

    expect(pos.top).toBeGreaterThanOrEqual(hole.top + hole.height + COACHMARK_GAP_PX);
    expect(pos.top + usedHeight).toBeLessThanOrEqual(
      VIEWPORT.height - COACHMARK_MARGIN_PX,
    );
    expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT.left + COACHMARK_MARGIN_PX);
    expect(pos.left + tooltip.width).toBeLessThanOrEqual(
      VIEWPORT.width - COACHMARK_MARGIN_PX,
    );
  });

  it('keeps a tooltip taller than the viewport beside the hole, not over it', () => {
    const hole = { top: 200, left: 16, width: 120, height: 40 };
    const tooltip = { width: 280, height: 520 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.top).toBe(hole.top + hole.height + COACHMARK_GAP_PX);
    expect(pos.maxHeight).toBeLessThan(tooltip.height);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(
      VIEWPORT.height - COACHMARK_MARGIN_PX,
    );
  });

  it('clamps left when the hole sits near the right edge', () => {
    const hole = { top: 80, left: 300, width: 50, height: 40 };
    const tooltip = { width: 280, height: 100 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.left + tooltip.width).toBeLessThanOrEqual(
      VIEWPORT.width - COACHMARK_MARGIN_PX,
    );
  });
});
