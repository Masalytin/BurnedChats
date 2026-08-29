import { useLayoutEffect, useState } from 'react';

import { Coachmark } from '@/components/Coachmark';

export type HomeTourId = 'search' | 'create-room' | 'my-qr';

export interface HomeTourStep {
  tourId: HomeTourId;
  topicKey: string;
}

export interface HomeTourProps {
  open: boolean;
  onComplete: () => void;
  onSkipAll: () => void;
}

export const HOME_TOUR_STEPS: readonly HomeTourStep[] = [
  { tourId: 'search', topicKey: 'tour.homeSearch' },
  { tourId: 'create-room', topicKey: 'tour.homeCreateRoom' },
  { tourId: 'my-qr', topicKey: 'tour.homeMyQr' },
];

function resolveTourTarget(tourId: HomeTourId): HTMLElement | null {
  const node = document.querySelector(`[data-tour="${tourId}"]`);
  return node instanceof HTMLElement ? node : null;
}

function visibleSteps(): HomeTourStep[] {
  return HOME_TOUR_STEPS.filter((step) => resolveTourTarget(step.tourId) !== null);
}

function scrollTargetIntoLayout(target: HTMLElement): void {
  const layout = document.querySelector('.layout-main');
  if (!(layout instanceof HTMLElement)) {
    return;
  }
  const layoutRect = layout.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  if (rect.top < layoutRect.top || rect.bottom > layoutRect.bottom) {
    target.scrollIntoView({ block: 'center' });
  }
}

/**
 * Three-step Home coachmark controller. Resolves `[data-tour]` here only —
 * Coachmark never querySelector-s a target.
 */
export function HomeTour({ open, onComplete, onSkipAll }: HomeTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState<HomeTourStep[]>([]);

  useLayoutEffect(() => {
    if (!open) {
      setStepIndex(0);
      setSteps([]);
      return;
    }
    const next = visibleSteps();
    if (next.length === 0) {
      onComplete();
      return;
    }
    setSteps(next);
  }, [open, onComplete]);

  const current = steps[stepIndex] ?? null;
  const target = current ? resolveTourTarget(current.tourId) : null;

  useLayoutEffect(() => {
    if (!open || !target) {
      return;
    }
    scrollTargetIntoLayout(target);
  }, [open, target, stepIndex]);

  if (!open || !current) {
    return null;
  }

  const handleNext = (): void => {
    if (stepIndex >= steps.length - 1) {
      onComplete();
      return;
    }
    setStepIndex((index) => index + 1);
  };

  return (
    <Coachmark
      target={target}
      topicKey={current.topicKey}
      stepIndex={stepIndex}
      stepCount={steps.length}
      onNext={handleNext}
      onSkipAll={onSkipAll}
    />
  );
}
