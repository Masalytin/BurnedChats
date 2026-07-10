// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { BurnAllDialog } from './BurnAllDialog';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('BurnAllDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders data mode title', () => {
    render(
      <BurnAllDialog mode="data" open onConfirm={vi.fn()} onClose={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText('Burn all data')).toBeTruthy();
  });

  it('requires account acknowledgement checkbox before hold can complete', () => {
    const onConfirm = vi.fn();
    render(
      <BurnAllDialog mode="account" open onConfirm={onConfirm} onClose={vi.fn()} />,
      { wrapper },
    );

    const holdButton = screen.getByRole('button', { name: /hold to burn/i });
    fireEvent.pointerDown(holdButton);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.pointerDown(holdButton);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels hold when pointer released early', () => {
    const onConfirm = vi.fn();
    render(
      <BurnAllDialog mode="data" open onConfirm={onConfirm} onClose={vi.fn()} />,
      { wrapper },
    );

    const holdButton = screen.getByRole('button', { name: /hold to burn/i });
    fireEvent.pointerDown(holdButton);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.pointerUp(holdButton);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
