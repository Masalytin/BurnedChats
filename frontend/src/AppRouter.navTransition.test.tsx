// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Never-resolving lazy child keeps the nearest Suspense pending — the same
 * shape as App's wrapWalletProvider (Suspense around LazyWalletProvider).
 */
const Pending = lazy(() => new Promise<{ default: (props: { children?: ReactNode }) => ReactNode }>(() => {}));

function PathnameShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.startsWith('/app/wallet') ? (
    <div data-testid="wallet-page">Wallet</div>
  ) : (
    <div data-testid="home-page">Home</div>
  );

  return (
    <div>
      <button type="button" onClick={() => navigate('/app/wallet')}>
        Go wallet
      </button>
      <Suspense fallback={page}>
        <Pending>{page}</Pending>
      </Suspense>
    </div>
  );
}

function renderShell(useTransitions?: boolean) {
  window.history.pushState({}, '', '/app');
  return render(
    <BrowserRouter useTransitions={useTransitions}>
      <Routes>
        <Route path="/app/*" element={<PathnameShell />} />
      </Routes>
    </BrowserRouter>,
  );
}

describe('RR7 startTransition vs pathname-based App views', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('switches to Wallet when transitions are off, even if Suspense is pending', () => {
    renderShell(false);
    expect(screen.getByTestId('home-page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go wallet' }));

    expect(window.location.pathname).toBe('/app/wallet');
    expect(screen.getByTestId('wallet-page')).toBeTruthy();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });
});
