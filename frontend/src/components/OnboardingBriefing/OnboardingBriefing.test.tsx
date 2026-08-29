// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { OnboardingBriefing } from './OnboardingBriefing';

function renderBriefing(onDismiss = vi.fn()) {
  return {
    onDismiss,
    ...render(
      <I18nextProvider i18n={i18n}>
        <OnboardingBriefing onDismiss={onDismiss} />
      </I18nextProvider>,
    ),
  };
}

function tHome(key: string): string {
  return i18n.t(`home.${key}`);
}

function tQuiz(key: string): string {
  return i18n.t(`home.onboardingQuiz.${key}`);
}

function goToQuiz() {
  fireEvent.click(screen.getByRole('button', { name: tHome('onboardingContinue') }));
}

function clickQuizChoice(key: string) {
  fireEvent.click(screen.getByRole('button', { name: tQuiz(key) }));
}

describe('OnboardingBriefing', () => {
  it('uses the shared primary Button for Got it, not a bare control', () => {
    renderBriefing();
    const cta = screen.getByRole('button', { name: tHome('onboardingContinue') });
    expect(cta.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['button', 'button--primary', 'button--full-width']),
    );
  });

  it('shows briefing copy and CTA on mount, without the quiz or dismiss', () => {
    const { onDismiss } = renderBriefing();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(tHome('onboardingTitle'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingKeys'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingInvite'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingRooms'))).toBeTruthy();
    expect(screen.getByRole('button', { name: tHome('onboardingContinue') })).toBeTruthy();

    expect(screen.queryByText(tQuiz('keysQuestion'))).toBeNull();
    expect(screen.queryByText(tQuiz('burnQuestion'))).toBeNull();
    expect(screen.queryByRole('button', { name: tQuiz('skip') })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('opens the quiz on Continue instead of dismissing', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();

    expect(screen.getByText(tQuiz('title'))).toBeTruthy();
    expect(screen.getByText(tQuiz('keysQuestion'))).toBeTruthy();
    expect(screen.getByRole('button', { name: tQuiz('keysWrong') })).toBeTruthy();
    expect(screen.getByRole('button', { name: tQuiz('keysRight') })).toBeTruthy();
    expect(screen.queryByText(tQuiz('burnQuestion'))).toBeNull();
    expect(screen.queryByRole('button', { name: tHome('onboardingContinue') })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps the same keys question and shows a hint after a wrong answer', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();
    clickQuizChoice('keysWrong');

    expect(screen.getByText(tQuiz('keysHint'))).toBeTruthy();
    expect(screen.getByText(tQuiz('keysQuestion'))).toBeTruthy();
    expect(screen.queryByText(tQuiz('burnQuestion'))).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('advances to the burn question after a right keys answer, then stays after a wrong burn answer', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();
    clickQuizChoice('keysRight');

    expect(screen.getByText(tQuiz('burnQuestion'))).toBeTruthy();
    expect(screen.queryByText(tQuiz('keysQuestion'))).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    clickQuizChoice('burnWrong');

    expect(screen.getByText(tQuiz('burnHint'))).toBeTruthy();
    expect(screen.getByText(tQuiz('burnQuestion'))).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses once after two right answers in a row', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();
    clickQuizChoice('keysRight');
    clickQuizChoice('burnRight');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses once from Skip on the quiz without requiring right answers', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();
    fireEvent.click(screen.getByRole('button', { name: tQuiz('skip') }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not always put the correct choice last; clicks use i18n keys not index 0', () => {
    const { onDismiss } = renderBriefing();
    goToQuiz();

    const keysWrong = screen.getByRole('button', { name: tQuiz('keysWrong') });
    const keysRight = screen.getByRole('button', { name: tQuiz('keysRight') });
    const keysOrder = keysWrong.compareDocumentPosition(keysRight);
    const keysWrongFirst = (keysOrder & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const keysRightFirst = (keysOrder & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    expect(keysWrongFirst || keysRightFirst).toBe(true);

    clickQuizChoice('keysRight');

    const burnWrong = screen.getByRole('button', { name: tQuiz('burnWrong') });
    const burnRight = screen.getByRole('button', { name: tQuiz('burnRight') });
    const burnOrder = burnWrong.compareDocumentPosition(burnRight);
    const burnWrongFirst = (burnOrder & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const burnRightFirst = (burnOrder & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    expect(burnWrongFirst || burnRightFirst).toBe(true);

    const bothQuestionsWrongFirst = keysWrongFirst && burnWrongFirst;
    expect(bothQuestionsWrongFirst).toBe(false);

    clickQuizChoice('burnRight');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
