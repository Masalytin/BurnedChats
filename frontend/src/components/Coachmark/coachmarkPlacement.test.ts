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

  it('clamps a tall tooltip so Next stays inside a short visual viewport', () => {
    const hole = { top: 80, left: 16, width: 328, height: 280 };
    const tooltip = { width: 280, height: 220 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT.top + COACHMARK_MARGIN_PX);
    expect(pos.top + tooltip.height).toBeLessThanOrEqual(
      VIEWPORT.height - COACHMARK_MARGIN_PX,
    );
    expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT.left + COACHMARK_MARGIN_PX);
    expect(pos.left + tooltip.width).toBeLessThanOrEqual(
      VIEWPORT.width - COACHMARK_MARGIN_PX,
    );
  });

  it('pins a tooltip taller than the viewport to the top so CSS can scroll it', () => {
    const hole = { top: 200, left: 16, width: 120, height: 40 };
    const tooltip = { width: 280, height: 520 };

    const pos = placeCoachmarkTooltip(hole, tooltip, VIEWPORT);

    expect(pos.top).toBe(VIEWPORT.top + COACHMARK_MARGIN_PX);
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
