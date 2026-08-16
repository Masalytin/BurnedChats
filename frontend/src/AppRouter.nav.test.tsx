// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  default: function MockApp() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <div>
        <div data-testid="pathname">{location.pathname}</div>
        <button type="button" onClick={() => navigate('/app')}>
          Go home
        </button>
        <button type="button" onClick={() => navigate('/app/wallet')}>
          Go wallet
        </button>
        <button type="button" onClick={() => navigate('/app/settings')}>
          Go settings
        </button>
      </div>
    );
  },
}));

vi.mock('./pages/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing">landing</div>,
}));

vi.mock('./env/detector', () => ({
  isTelegramMiniApp: () => false,
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppRouter } from './AppRouter';

const ROUTER_SOURCE = readFileSync(resolve(__dirname, 'AppRouter.tsx'), 'utf8');

describe('AppRouter top-level tab paths', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('keeps /app/wallet and /app/settings on App instead of bouncing to landing', () => {
    window.history.pushState({}, '', '/app');
    render(<AppRouter />);

    expect(screen.getByTestId('pathname').textContent).toBe('/app');

    fireEvent.click(screen.getByRole('button', { name: 'Go wallet' }));
    expect(screen.getByTestId('pathname').textContent).toBe('/app/wallet');
    expect(screen.queryByTestId('landing')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go settings' }));
    expect(screen.getByTestId('pathname').textContent).toBe('/app/settings');
    expect(screen.queryByTestId('landing')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }));
    expect(screen.getByTestId('pathname').textContent).toBe('/app');
  });

  it('disables RR7 startTransition so splat pathname views commit with the URL', () => {
    expect(ROUTER_SOURCE).toMatch(/<BrowserRouter useTransitions=\{false\}>/);
  });
});
