// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ExitDialog } from './ExitDialog';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('ExitDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders title and both exit options when open', () => {
    render(
      <ExitDialog
        open
        onClose={vi.fn()}
        onJustExit={vi.fn()}
        onBurnAndExit={vi.fn()}
        onRetryBurnAndExit={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByText('Leave the app?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /just leave/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /burn everything and leave/i })).toBeTruthy();
  });

  it('calls onJustExit when "Just leave" is tapped', () => {
    const onJustExit = vi.fn();
    render(
      <ExitDialog
        open
        onClose={vi.fn()}
        onJustExit={onJustExit}
        onBurnAndExit={vi.fn()}
        onRetryBurnAndExit={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /just leave/i }));
    expect(onJustExit).toHaveBeenCalledTimes(1);
  });

  it('calls onBurnAndExit when "Burn everything and leave" is tapped', () => {
    const onBurnAndExit = vi.fn();
    render(
      <ExitDialog
        open
        onClose={vi.fn()}
        onJustExit={vi.fn()}
        onBurnAndExit={onBurnAndExit}
        onRetryBurnAndExit={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /burn everything and leave/i }));
    expect(onBurnAndExit).toHaveBeenCalledTimes(1);
  });

  it('shows timeout error with retry and does not close while burning', () => {
    const onClose = vi.fn();
    const onRetryBurnAndExit = vi.fn();
    render(
      <ExitDialog
        open
        isBurning={false}
        error="TIMEOUT"
        onClose={onClose}
        onJustExit={vi.fn()}
        onBurnAndExit={vi.fn()}
        onRetryBurnAndExit={onRetryBurnAndExit}
      />,
      { wrapper },
    );

    expect(screen.getByText(/server data may still exist/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetryBurnAndExit).toHaveBeenCalledTimes(1);
  });

  it('disables actions while burning', () => {
    render(
      <ExitDialog
        open
        isBurning
        onClose={vi.fn()}
        onJustExit={vi.fn()}
        onBurnAndExit={vi.fn()}
        onRetryBurnAndExit={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /just leave/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /loading/i })).toHaveProperty('disabled', true);
  });
});
