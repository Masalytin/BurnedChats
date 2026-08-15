// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { JoinLanding } from '../JoinLanding';

function renderLanding(props: Partial<Parameters<typeof JoinLanding>[0]> = {}) {
  const onOpenTelegram = vi.fn();
  const onContinueInBrowser = vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <JoinLanding
        valid
        token="tok99"
        onOpenTelegram={onOpenTelegram}
        onContinueInBrowser={onContinueInBrowser}
        {...props}
      />
    </I18nextProvider>,
  );
  return { ...result, onOpenTelegram, onContinueInBrowser };
}

describe('JoinLanding', () => {
  it('shows room copy by default and not DM copy', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: i18n.t('joinLanding.title') })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: i18n.t('joinLanding.dmTitle') })).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('joinLanding.openInTelegram') })).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('joinLanding.continueInBrowser') })).toBeTruthy();
  });

  it('shows DM copy for kind=dm and never reuses room title or a username', () => {
    renderLanding({ kind: 'dm' });
    expect(screen.getByRole('heading', { name: i18n.t('joinLanding.dmTitle') })).toBeTruthy();
    expect(screen.queryByText(i18n.t('joinLanding.title'))).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('joinLanding.openInTelegram') })).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('joinLanding.continueInBrowser') })).toBeTruthy();
  });

  it('calls onOpenTelegram from the primary CTA', () => {
    const { onOpenTelegram } = renderLanding({ kind: 'dm' });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('joinLanding.openInTelegram') }));
    expect(onOpenTelegram).toHaveBeenCalledTimes(1);
  });

  it('invalid hint is not room-owner-only', () => {
    renderLanding({ valid: false });
    expect(screen.getByRole('heading', { name: i18n.t('joinLanding.invalidTitle') })).toBeTruthy();
    const hint = screen.getByText(i18n.t('joinLanding.invalidHint'));
    expect(hint).toBeTruthy();
    expect(hint.textContent?.toLowerCase()).not.toMatch(/room owner/);
  });
});
