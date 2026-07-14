// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { VerificationStatus } from '@/hooks/useVerification';
import type { VisualFingerprintElement } from '@/types';
import {
  claimBothVerifiedToast,
  forgetBothVerifiedToast,
} from '@/utils/claimBothVerifiedToast';
import { VerificationView } from './VerificationView';

import ar from '@/i18n/locales/ar.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import fr from '@/i18n/locales/fr.json';
import ru from '@/i18n/locales/ru.json';
import uk from '@/i18n/locales/uk.json';
import zhCN from '@/i18n/locales/zh-CN.json';

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

function status(overrides: Partial<VerificationStatus> = {}): VerificationStatus {
  return {
    sessionId: 'sess-1',
    selfVerified: false,
    peerVerified: false,
    bothVerified: false,
    verifiedAt: null,
    mismatchReported: false,
    ...overrides,
  };
}

describe('VerificationView auto-continue', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('calls onConfirm on Match tap but does not auto-continue while still pending', () => {
    const onConfirm = vi.fn();
    const onContinue = vi.fn();

    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status()}
        peer={null}
        sessionId="sess-1"
        onConfirm={onConfirm}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /fingerprint matches/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('auto-continues once when selfVerified becomes true (C2)', () => {
    const onContinue = vi.fn();
    const { rerender } = render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status()}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    expect(onContinue).not.toHaveBeenCalled();

    rerender(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ selfVerified: true })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('auto-continues when bothVerified becomes true on screen (C1)', () => {
    const onContinue = vi.fn();
    const { rerender } = render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status()}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    rerender(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ bothVerified: true, selfVerified: true, peerVerified: true })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('auto-continues on mount when already selfVerified (re-entry)', () => {
    const onContinue = vi.fn();

    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ selfVerified: true })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('does not auto-continue when mismatchReported; mismatch UI stays interactive', () => {
    const onContinue = vi.fn();
    const onMismatch = vi.fn();

    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ mismatchReported: true, selfVerified: false })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={onMismatch}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/fingerprints do not match/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /continue anyway/i }),
    ).toBeTruthy();
  });

  it('calls onContinue only once across sequential verified status updates', () => {
    const onContinue = vi.fn();
    const { rerender } = render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ selfVerified: true })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    expect(onContinue).toHaveBeenCalledTimes(1);

    rerender(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({
          selfVerified: true,
          peerVerified: true,
          bothVerified: true,
        })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('does not auto-continue while status stays pending (offline / no optimistic update)', () => {
    const onConfirm = vi.fn();
    const onContinue = vi.fn();

    const { rerender } = render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status()}
        peer={null}
        sessionId="sess-1"
        onConfirm={onConfirm}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /fingerprint matches/i }));
    // Parent would leave status pending when confirmVerification early-exits offline
    rerender(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status()}
        peer={null}
        sessionId="sess-1"
        onConfirm={onConfirm}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /fingerprint matches/i })).toBeTruthy();
  });

  it('preserves waiting_peer fallback markup when selfVerified', () => {
    const onContinue = vi.fn();

    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({ selfVerified: true })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    // Parent may leave the view mounted until navigation; fallback UI must still exist
    expect(screen.getByText(/waiting for peer to verify/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /skip and continue/i })).toBeTruthy();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('preserves both_verified fallback markup when bothVerified', () => {
    const onContinue = vi.fn();

    render(
      <VerificationView
        fingerprint={FINGERPRINT}
        status={status({
          selfVerified: true,
          peerVerified: true,
          bothVerified: true,
        })}
        peer={null}
        sessionId="sess-1"
        onConfirm={vi.fn()}
        onMismatch={vi.fn()}
        onContinue={onContinue}
      />,
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /continue to chat/i })).toBeTruthy();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('claimBothVerifiedToast (false→true dedup)', () => {
  it('claims only the first transition per session and allows reclaim after forget', () => {
    const seen = new Set<string>();

    expect(claimBothVerifiedToast(seen, 'sess-a')).toBe(true);
    expect(claimBothVerifiedToast(seen, 'sess-a')).toBe(false);
    expect(claimBothVerifiedToast(seen, 'sess-b')).toBe(true);

    forgetBothVerifiedToast(seen, 'sess-a');
    expect(claimBothVerifiedToast(seen, 'sess-a')).toBe(true);
  });
});

describe('verification.verifiedToast i18n', () => {
  it('is present in all 8 locales', () => {
    const locales = { en, ru, de, fr, es, ar, 'zh-CN': zhCN, uk };
    for (const [name, catalog] of Object.entries(locales)) {
      const value = (catalog as { verification?: { verifiedToast?: string } })
        .verification?.verifiedToast;
      expect(value, `${name} missing verification.verifiedToast`).toBeTruthy();
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
