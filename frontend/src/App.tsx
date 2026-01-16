import { useEffect, useState } from 'react';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout/Layout';
import { HomePage } from './pages/HomePage';
import './App.css';

function App() {
  const { 
    isReady, 
    isInTelegram,
    user, 
    expand, 
    setClosingConfirmation, 
    setHeaderColor,
    notificationOccurred,
  } = useTelegram();
  
  const { 
    isConnected, 
    isConnecting,
    error: wsError,
    reconnectAttempt,
    connect, 
    disconnect,
  } = useWebSocket({
    onConnect: () => {
      notificationOccurred('success');
    },
    onError: (error) => {
      if (!error.recoverable) {
        notificationOccurred('error');
      }
    },
  });

  const [initError, setInitError] = useState<string | null>(null);

  // Initialize Mini App
  useEffect(() => {
    if (isReady) {
      // Expand the Mini App to full height
      expand();
      
      // Enable closing confirmation
      setClosingConfirmation(true);
      
      // Set header color to match theme
      setHeaderColor('secondary_bg_color');
    }
  }, [isReady, expand, setClosingConfirmation, setHeaderColor]);

  // Connect to WebSocket when ready
  useEffect(() => {
    if (!isReady) return;

    // In production, require Telegram environment
    if (import.meta.env.PROD && !isInTelegram) {
      setInitError('Please open this app from Telegram');
      return;
    }

    // Connect when we have user data (or in dev mode)
    if (user || import.meta.env.DEV) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [isReady, isInTelegram, user, connect, disconnect]);

  // Loading state
  if (!isReady) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading BurnedChats...</p>
      </div>
    );
  }

  // Initialization error
  if (initError) {
    return (
      <div className="error-screen">
        <div className="error-icon">⚠️</div>
        <h2>Cannot Start App</h2>
        <p>{initError}</p>
      </div>
    );
  }

  // Non-recoverable WebSocket error
  if (wsError && !wsError.recoverable) {
    return (
      <div className="error-screen">
        <div className="error-icon">🔒</div>
        <h2>Connection Error</h2>
        <p>{wsError.message}</p>
        <button 
          className="retry-button"
          onClick={() => window.location.reload()}
        >
          Restart App
        </button>
      </div>
    );
  }

  return (
    <Layout>
      <HomePage 
        user={user} 
        isConnected={isConnected}
        isConnecting={isConnecting}
        reconnectAttempt={reconnectAttempt}
      />
    </Layout>
  );
}

export default App;


