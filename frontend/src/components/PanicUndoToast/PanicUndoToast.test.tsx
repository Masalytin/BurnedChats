// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { PanicUndoToast } from './PanicUndoToast';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('PanicUndoToast', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows countdown message and cancel button when open', () => {
    render(
      <PanicUndoToast open countdownSeconds={3} onCancel={vi.fn()} onExpire={vi.fn()} />,
      { wrapper },
    );

    expect(screen.getByText(/burning everything in 3/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('calls onCancel and stops countdown when cancel is tapped', () => {
    const onCancel = vi.fn();
    const onExpire = vi.fn();
    render(
      <PanicUndoToast open countdownSeconds={3} onCancel={onCancel} onExpire={onExpire} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('calls onExpire after countdown reaches zero', () => {
    const onExpire = vi.fn();
    render(
      <PanicUndoToast open countdownSeconds={3} onCancel={vi.fn()} onExpire={onExpire} />,
      { wrapper },
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('updates visible countdown each second', () => {
    render(
      <PanicUndoToast open countdownSeconds={3} onCancel={vi.fn()} onExpire={vi.fn()} />,
      { wrapper },
    );

    expect(screen.getByText(/in 3/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/in 2/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/in 1/i)).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <PanicUndoToast open={false} countdownSeconds={3} onCancel={vi.fn()} onExpire={vi.fn()} />,
      { wrapper },
    );

    expect(container.firstChild).toBeNull();
  });
});
