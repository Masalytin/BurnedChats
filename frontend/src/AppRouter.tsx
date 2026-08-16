import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import App from './App';
import { isTelegramMiniApp } from './env/detector';
import { LandingPage } from './pages/LandingPage/LandingPage';
import { rootLandingRedirect } from './utils/inviteLink';

/**
 * Redirects Telegram Mini App users from `/` to `/app` (hash preserved);
 * browser `#dm_invite_` goes to `/join` instead of the marketing landing.
 */
function TelegramLandingGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const redirect = rootLandingRedirect(location.hash, isTelegramMiniApp());
  if (redirect) {
    return <Navigate to={redirect} replace />;
  }
  return <>{children}</>;
}

export function AppRouter() {
  // App swaps Home/Wallet/Settings via useLocation() inside a /app/* splat,
  // under Suspense(LazyWalletProvider). RR7's default startTransition keeps
  // the previous UI while that boundary is pending — URL updates, Home stays.
  return (
    <BrowserRouter useTransitions={false}>
      <Routes>
        <Route
          path="/"
          element={
            <TelegramLandingGuard>
              <LandingPage />
            </TelegramLandingGuard>
          }
        />
        <Route path="/join" element={<App />} />
        <Route path="/app/*" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
