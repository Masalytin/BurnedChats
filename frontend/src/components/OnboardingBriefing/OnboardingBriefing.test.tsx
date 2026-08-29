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

describe('OnboardingBriefing', () => {
  it('uses the shared primary Button for Got it, not a bare control', () => {
    renderBriefing();
    const cta = screen.getByRole('button', { name: tHome('onboardingContinue') });
    expect(cta.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['button', 'button--primary', 'button--full-width']),
    );
  });

  it('shows briefing copy and CTA on mount, without a quiz', () => {
    const { onDismiss } = renderBriefing();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(tHome('onboardingTitle'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingKeys'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingInvite'))).toBeTruthy();
    expect(screen.getByText(tHome('onboardingRooms'))).toBeTruthy();
    expect(screen.getByRole('button', { name: tHome('onboardingContinue') })).toBeTruthy();
    expect(screen.queryByText('Quick check')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses once on Got it and does not open a quiz', () => {
    const { onDismiss } = renderBriefing();

    fireEvent.click(screen.getByRole('button', { name: tHome('onboardingContinue') }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Quick check')).toBeNull();
    expect(screen.getByText(tHome('onboardingTitle'))).toBeTruthy();
  });
});
