import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { useBackButton } from '@/hooks/useBackButton';

import {
  placeCoachmarkTooltip,
  readCoachmarkViewport,
  type CoachmarkHoleRect,
  type CoachmarkTooltipPos,
} from './coachmarkPlacement';
import './Coachmark.css';

export interface CoachmarkProps {
  target: HTMLElement | null;
  topicKey: string;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onSkipAll: () => void;
}

function readHoleRect(target: HTMLElement): CoachmarkHoleRect {
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Presentational spotlight: one target, portal overlay + hole + tooltip.
 * The parent owns steps and resolves the DOM node — this primitive never
 * querySelector-s a tour target.
 */
export function Coachmark({
  target,
  topicKey,
  stepIndex,
  stepCount,
  onNext,
  onSkipAll,
}: CoachmarkProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const primaryBtnRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [hole, setHole] = useState<CoachmarkHoleRect | null>(() =>
    target ? readHoleRect(target) : null,
  );
  const [tipPos, setTipPos] = useState<CoachmarkTooltipPos | null>(null);

  useBackButton({
    visible: true,
    onBack: onSkipAll,
  });

  useEffect(() => {
    let rafId = 0;

    const measure = () => {
      setHole(target ? readHoleRect(target) : null);
    };

    const schedule = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    };

    measure();

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    const layoutMain = document.querySelector('.layout-main');
    layoutMain?.addEventListener('scroll', schedule, { passive: true });

    return () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      viewport?.removeEventListener('resize', schedule);
      layoutMain?.removeEventListener('scroll', schedule);
    };
  }, [target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onSkipAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkipAll]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!hole || !tooltip) {
      setTipPos(null);
      return;
    }
    setTipPos(
      placeCoachmarkTooltip(
        hole,
        {
          width: tooltip.offsetWidth,
          height: Math.max(tooltip.offsetHeight, tooltip.scrollHeight),
        },
        readCoachmarkViewport(),
      ),
    );
  }, [hole, topicKey, stepIndex]);

  useEffect(() => {
    primaryBtnRef.current?.focus();
  }, [topicKey, stepIndex]);

  const titleKey = `help.${topicKey}.title`;
  const bodyKey = `help.${topicKey}.body`;
  const title = t(titleKey, { defaultValue: '' });
  const bodyRaw = t(bodyKey, { returnObjects: true, defaultValue: [] });
  const paragraphs = Array.isArray(bodyRaw)
    ? bodyRaw.filter((p): p is string => typeof p === 'string')
    : [];

  const isLastStep = stepIndex >= stepCount - 1;
  const primaryLabel = isLastStep
    ? t('help.tour.common.done', { defaultValue: 'Done' })
    : t('help.tour.common.next', { defaultValue: 'Next' });
  const skipLabel = t('help.tour.common.skip', { defaultValue: 'Skip tour' });

  const swallowPointer = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const tooltipStyle = tipPos
    ? {
        top: `${tipPos.top}px`,
        left: `${tipPos.left}px`,
        maxHeight: tipPos.maxHeight > 0 ? `${tipPos.maxHeight}px` : undefined,
      }
    : undefined;

  return createPortal(
    <div
      className={['coachmark-overlay', hole ? null : 'coachmark-overlay--full']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={swallowPointer}
    >
      {hole ? (
        <div
          className="coachmark-hole"
          role="presentation"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          onClick={swallowPointer}
        />
      ) : null}
      <div
        ref={tooltipRef}
        className="coachmark-tooltip"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
        style={tooltipStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="coachmark-tooltip__title">
          {title}
        </h2>
        <div className="coachmark-tooltip__body">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="coachmark-tooltip__paragraph">
              {paragraph}
            </p>
          ))}
        </div>
        <div className="coachmark-tooltip__actions">
          <Button
            ref={primaryBtnRef}
            type="button"
            variant="primary"
            onClick={onNext}
          >
            {primaryLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onSkipAll}>
            {skipLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
