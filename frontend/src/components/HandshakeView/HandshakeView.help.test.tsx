// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { HandshakeResult } from '@/hooks/useHandshake';
import { HandshakeView } from './HandshakeView';

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'test-init-data',
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

function makeResult(stage: HandshakeResult['stage']): HandshakeResult {
  return {
    stage,
    sessionId: 'sess-1',
    peer: null,
    fingerprint: null,
    error: null,
    progress: stage === 'waiting_peer' ? 60 : 30,
  };
}

describe('HandshakeView contextual help', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders HelpTrigger during in-progress handshake', () => {
    render(
      <HandshakeView result={makeResult('generating_keys')} onCancel={vi.fn()} />,
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /what is this/i })).toBeTruthy();
  });

  it('opens HelpSheet with handshake.about content from trigger', () => {
    render(
      <HandshakeView result={makeResult('generating_keys')} onCancel={vi.fn()} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Secure key exchange' })).toBeTruthy();
    expect(screen.getByText(/never sees your private keys/i)).toBeTruthy();
  });

  it('opens handshake.waiting topic while waiting for peer', () => {
    render(
      <HandshakeView result={makeResult('waiting_peer')} onCancel={vi.fn()} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    expect(screen.getByRole('heading', { level: 2, name: 'Waiting for your contact' })).toBeTruthy();
    expect(screen.getByText(/your contact needs to open the chat/i)).toBeTruthy();
  });

  it('keeps HelpSheet open with the same topic when handshake stage changes', () => {
    const { rerender } = render(
      <HandshakeView result={makeResult('generating_keys')} onCancel={vi.fn()} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));
    expect(screen.getByRole('heading', { level: 2, name: 'Secure key exchange' })).toBeTruthy();

    rerender(
      <HandshakeView result={makeResult('waiting_peer')} onCancel={vi.fn()} />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Secure key exchange' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Waiting for your contact' })).toBeNull();
  });
});
