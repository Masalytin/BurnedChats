import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRouter } from './AppRouter';
import { RootErrorBoundary } from './components/ErrorBoundary';
import { isTelegramMiniApp } from './env/detector';
import './i18n';
import './styles/theme.css';
import './styles/standalone-theme.css';
import { initializeAppEnvironment } from './env/initializer';
import { registerDownloadSaveServiceWorker } from './services/downloadSaveBridge';

initializeAppEnvironment();

if (isTelegramMiniApp() && !import.meta.env.DEV) {
  void registerDownloadSaveServiceWorker();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppRouter />
    </RootErrorBoundary>
  </React.StrictMode>
);


