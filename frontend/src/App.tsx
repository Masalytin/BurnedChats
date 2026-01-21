import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { useSearch } from './hooks/useSearch';
import { useSession, type PendingSession } from './hooks/useSession';
import { Layout } from './components/Layout/Layout';
import { ChatRequestDialog } from './components/ChatRequestDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { HomePage } from './pages/HomePage';
import type { UserInfo } from './types';
import './App.css';

/** Application view states */
type AppView = 'home' | 'pending-request';

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
    subscribe,
    unsubscribe,
    publish,
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

  // Search hook
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    result: searchResult,
    search,
    clearSearch,
    isSearching,
  } = useSearch({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  // Session hook
  const {
    result: sessionResult,
    createSession,
    reset: resetSession,
    isCreating: isCreatingSession,
  } = useSession({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onSessionCreated: (session) => {
      notificationOccurred('success');
      setCurrentView('pending-request');
      setPendingSession(session);
      setShowChatRequestDialog(false);
      setSelectedUser(null);
    },
    onError: () => {
      notificationOccurred('error');
    },
  });

  // App state
  const [initError, setInitError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [showChatRequestDialog, setShowChatRequestDialog] = useState(false);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);

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

  // Handle "Start Chat" button click from search results
  const handleStartChat = useCallback((targetUser: UserInfo) => {
    setSelectedUser(targetUser);
    setShowChatRequestDialog(true);
    resetSession();
  }, [resetSession]);

  // Handle closing the chat request dialog
  const handleCloseChatRequestDialog = useCallback(() => {
    setShowChatRequestDialog(false);
    setSelectedUser(null);
    resetSession();
  }, [resetSession]);

  // Handle submitting the chat request
  const handleSubmitChatRequest = useCallback((secretQuestion?: string) => {
    if (!selectedUser) return;
    createSession(selectedUser.id, secretQuestion);
  }, [selectedUser, createSession]);

  // Handle canceling the pending request
  const handleCancelPendingRequest = useCallback(() => {
    setCurrentView('home');
    setPendingSession(null);
    resetSession();
    clearSearch();
  }, [resetSession, clearSearch]);

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
        <div className="error-icon">&#9888;&#65039;</div>
        <h2>Cannot Start App</h2>
        <p>{initError}</p>
      </div>
    );
  }

  // Non-recoverable WebSocket error
  if (wsError && !wsError.recoverable) {
    return (
      <div className="error-screen">
        <div className="error-icon">&#128274;</div>
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

  // Pending request view
  if (currentView === 'pending-request' && pendingSession) {
    return (
      <Layout>
        <PendingRequestView
          session={pendingSession}
          onCancel={handleCancelPendingRequest}
        />
      </Layout>
    );
  }

  // Default: Home view
  return (
    <Layout>
      <HomePage 
        user={user} 
        isConnected={isConnected}
        isConnecting={isConnecting}
        reconnectAttempt={reconnectAttempt}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResult={searchResult}
        onSearch={search}
        onClearSearch={clearSearch}
        isSearching={isSearching}
        onStartChat={handleStartChat}
      />

      {/* Chat request dialog */}
      {showChatRequestDialog && selectedUser && (
        <ChatRequestDialog
          user={selectedUser}
          isLoading={isCreatingSession}
          error={sessionResult.error}
          onClose={handleCloseChatRequestDialog}
          onSubmit={handleSubmitChatRequest}
        />
      )}
    </Layout>
  );
}

export default App;

