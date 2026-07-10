// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { VerificationStatus } from '@/hooks/useVerification';
import type { VisualFingerprintElement } from '@/types';
import { VerificationView } from './VerificationView';

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

vi.mock('@/crypto/keyStore', () => ({
  getFingerprint: vi.fn(() => '12345 67890 23456 78901'),
}));

const FINGERPRINT: VisualFingerprintElement[] = [
  { emoji: '🦊' },
  { emoji: '🍎' },
  { emoji: '🚀' },
  { emoji: '🐼' },
  { emoji: '⭐' },
  { emoji: '🐧' },
];

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

const pendingStatus: VerificationStatus = {
  sessionId: 'sess-1',
  selfVerified: false,
  peerVerified: false,
  bothVerified: false,
  verifiedAt: null,
  mismatchReported: false,
};

const mismatchStatus: VerificationStatus = {
  sessionId: 'sess-1',
  selfVerified: false,
  peerVerified: false,
  bothVerified: false,
  verifiedAt: null,
  mismatchReported: true,
};

describe('VerificationView contextual help', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders HelpTrigger on pending verification screen', () => {
    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={pendingStatus}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /what is this/i })).toBeTruthy();
  });

  it('opens HelpSheet explaining the safety fingerprint', () => {
    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={pendingStatus}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Safety check' })).toBeTruthy();
    expect(screen.getByText(/compare them out loud/i)).toBeTruthy();
  });

  it('opens mismatch help topic when verification is in mismatch state', () => {
    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={mismatchStatus}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    expect(screen.getByRole('heading', { level: 2, name: "Patterns don't match" })).toBeTruthy();
    expect(screen.getByText(/do not trust this chat/i)).toBeTruthy();
  });
});
