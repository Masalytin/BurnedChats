// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import type { ActiveSession } from '../../hooks/useActiveSessions';
import type { UserInfo } from '../../types';
import { SessionCard } from './SessionCard';

const PEER: UserInfo = {
  internalId: 'peer-1',
  displayName: 'Alice',
  online: false,
  premium: false,
};

const CREATED_AT = 1_700_000_000_000;
const EXPIRES_AT = CREATED_AT + 5 * 60 * 1000;

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: 'sess-pending',
    status: 'PENDING',
    peer: PEER,
    verified: false,
    peerVerified: false,
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    isInitiator: true,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function renderCard(props: {
  session?: ActiveSession;
  onClick?: () => void;
  onBurn?: (sessionId: string, peerName: string) => void;
}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SessionCard
        session={props.session ?? session()}
        onClick={props.onClick}
        onBurn={props.onBurn}
      />
    </I18nextProvider>,
  );
}

describe('SessionCard PENDING cancel CTA (IMP-DMPEND-02)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows Cancel/Burn for a PENDING session when onBurn is provided (E11/E12)', () => {
    renderCard({ onBurn: vi.fn() });

    expect(
      screen.getByRole('button', { name: i18n.t('sessionCard.cancelPending') }),
    ).toBeTruthy();
  });

  it('burn click calls onBurn and does not fire the card onClick (E12)', () => {
    const onBurn = vi.fn();
    const onClick = vi.fn();
    renderCard({ onBurn, onClick });

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('sessionCard.cancelPending') }),
    );

    expect(onBurn).toHaveBeenCalledTimes(1);
    expect(onBurn).toHaveBeenCalledWith('sess-pending', 'Alice');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not show Cancel/Burn on PENDING when onBurn is omitted', () => {
    renderCard({});

    expect(
      screen.queryByRole('button', { name: i18n.t('sessionCard.cancelPending') }),
    ).toBeNull();
  });

  it('still shows burn on ACTIVE with the existing aria-label', () => {
    renderCard({
      session: session({ status: 'ACTIVE', sessionId: 'sess-active' }),
      onBurn: vi.fn(),
    });

    expect(
      screen.getByRole('button', { name: i18n.t('chat.burnSessionAria') }),
    ).toBeTruthy();
  });
});

