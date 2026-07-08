import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import { isTelegramMiniApp } from './env/detector';
import { LandingPage } from './pages/LandingPage/LandingPage';

/**
 * Redirects Telegram Mini App users from `/` to `/app`; otherwise renders landing.
 */
function TelegramLandingGuard({ children }: { children: ReactNode }) {
  if (isTelegramMiniApp()) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
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
