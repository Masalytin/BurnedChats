// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionFlowState } from '../hooks/useDebugState';
import { FlowTab } from './FlowTab';

function waitingPeerState(overrides: Partial<SessionFlowState> = {}): SessionFlowState {
  return {
    currentFlow: 'handshaking',
    sessionId: 'sess-wait',
    peerId: 1,
    peerName: 'Peer',
    handshakeStage: 'waiting_peer',
    handshakeProgress: 50,
    handshakeElapsedMs: 2400,
    handshakeIsTakingLonger: false,
    hasLocalKeys: true,
    hasPeerKey: false,
    hasSharedSecret: false,
    lastError: null,
    errorTimestamp: null,
    ...overrides,
  };
}

describe('FlowTab waiting_peer elapsed (IMP-DBGPANEL-08)', () => {
  it('shows elapsed time on waiting_peer, not only the static stage label', () => {
    render(<FlowTab state={waitingPeerState()} timeline={[]} />);

    expect(screen.getByText(/waiting_peer/)).toBeTruthy();
    expect(screen.getByText(/2400\s*ms|2\.4\s*s/)).toBeTruthy();
  });

  it('shows taking-longer hint when handshakeIsTakingLonger is true', () => {
    render(
      <FlowTab
        state={waitingPeerState({ handshakeElapsedMs: 16000, handshakeIsTakingLonger: true })}
        timeline={[]}
      />,
    );

    expect(screen.getByText(/taking longer/i)).toBeTruthy();
  });

  it('does not show elapsed when stage is not waiting_peer', () => {
    render(
      <FlowTab
        state={waitingPeerState({
          handshakeStage: 'generating_keys',
          handshakeProgress: 10,
          handshakeElapsedMs: 2400,
        })}
        timeline={[]}
      />,
    );

    expect(screen.queryByText(/2400\s*ms|2\.4\s*s/)).toBeNull();
  });
});
