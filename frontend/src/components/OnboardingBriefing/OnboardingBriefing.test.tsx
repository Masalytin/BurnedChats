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

describe('OnboardingBriefing', () => {
  it('uses the shared primary Button for Got it, not a bare control', () => {
    renderBriefing();
    const cta = screen.getByRole('button', { name: i18n.t('home.onboardingContinue') });
    expect(cta.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['button', 'button--primary', 'button--full-width']),
    );
  });

  it('dismisses from the primary CTA', () => {
    const { onDismiss } = renderBriefing();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('home.onboardingContinue') }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
