// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { STORAGE_KEY } from '@/i18n/languagePreference';
import { LanguagePickScreen } from './LanguagePickScreen';

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: false,
    publish: vi.fn(),
  }),
}));

function renderPick(onConfirm = vi.fn()) {
  return {
    onConfirm,
    ...render(
      <I18nextProvider i18n={i18n}>
        <LanguagePickScreen onConfirm={onConfirm} />
      </I18nextProvider>,
    ),
  };
}

describe('LanguagePickScreen', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('lists native language names and does not load flag CDN images', () => {
    renderPick();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Русский')).toBeTruthy();
    expect(screen.getByText('Українська')).toBeTruthy();
    expect(screen.getByText('简体中文')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.documentElement.innerHTML).not.toContain('flagcdn.com');
  });

  it('changes i18n language on row tap before confirm', async () => {
    const { onConfirm } = renderPick();

    fireEvent.click(screen.getByRole('button', { name: 'Русский' }));

    expect(i18n.language).toBe('ru');
    expect(screen.getByRole('heading', { name: i18n.t('onboarding.language.title') })).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('onboarding.language.continue') })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('writes preferred_language and calls onConfirm on Continue', () => {
    const { onConfirm } = renderPick();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('onboarding.language.continue') }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('sets dir=rtl when Arabic is selected', async () => {
    renderPick();

    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));

    expect(i18n.language).toBe('ar');
    expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl');
  });
});
