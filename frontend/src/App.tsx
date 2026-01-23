import { useEffect, useState, useCallback, useRef } from 'react';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { useSearch } from './hooks/useSearch';
import { useSession, type PendingSession } from './hooks/useSession';
import { useIncomingRequests } from './hooks/useIncomingRequests';
import { useHandshake } from './hooks/useHandshake';
import { Layout } from './components/Layout/Layout';
import { ChatRequestDialog } from './components/ChatRequestDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { IncomingRequestView } from './components/IncomingRequestView';
import { HandshakeView } from './components/HandshakeView';
import { HomePage } from './pages/HomePage';
import type { UserInfo, ChatRequest } from './types';
import './App.css';

/** Application view states */
type AppView = 'home' | 'pending-request' | 'incoming-request' | 'handshake';

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

  // Incoming requests hook
  const {
    actionResult: incomingActionResult,
    acceptRequest,
    rejectRequest,
    resetAction: resetIncomingAction,
  } = useIncomingRequests({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onRequestReceived: (request) => {
      notificationOccurred('success');
      // If we're on home, show the incoming request
      if (currentView === 'home') {
        setActiveIncomingRequest(request);
        setCurrentView('incoming-request');
      }
    },
    onSessionAccepted: (sessionId, peer) => {
      // Start handshake after accepting a request
      notificationOccurred('success');
      handshakePeerRef.current = peer;
      startHandshake(sessionId, peer);
      setCurrentView('handshake');
    },
    onError: () => {
      notificationOccurred('error');
    },
  });

  // Handshake hook
  const {
    result: handshakeResult,
    startHandshake,
    cancelHandshake,
    reset: resetHandshake,
    isComplete: isHandshakeComplete,
  } = useHandshake({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onHandshakeComplete: (sessionId, fingerprint) => {
      notificationOccurred('success');
      console.log('[App] Handshake complete:', sessionId, fingerprint);
      // TODO: Navigate to chat view (Sprint 4)
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
  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);

  // Reference to store peer info for handshake
  const handshakePeerRef = useRef<UserInfo | null>(null);

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

  // Handle accepting an incoming request
  const handleAcceptRequest = useCallback((secretAnswer?: string) => {
    if (!activeIncomingRequest) return;
    acceptRequest(activeIncomingRequest.id, secretAnswer);
  }, [acceptRequest, activeIncomingRequest]);

  // Handle rejecting an incoming request
  const handleRejectRequest = useCallback(() => {
    if (!activeIncomingRequest) return;
    rejectRequest(activeIncomingRequest.id);
    setActiveIncomingRequest(null);
    setCurrentView('home');
  }, [rejectRequest, activeIncomingRequest]);

  // Handle closing incoming request view
  const handleCloseIncomingRequest = useCallback(() => {
    setActiveIncomingRequest(null);
    resetIncomingAction();
    setCurrentView('home');
  }, [resetIncomingAction]);

  // Handle canceling handshake
  const handleCancelHandshake = useCallback(() => {
    cancelHandshake();
    handshakePeerRef.current = null;
    setCurrentView('home');
    setPendingSession(null);
    setActiveIncomingRequest(null);
    resetSession();
    clearSearch();
  }, [cancelHandshake, resetSession, clearSearch]);

  // Handle continuing after handshake complete
  const handleHandshakeComplete = useCallback(() => {
    // TODO: Navigate to chat view (Sprint 4)
    // For now, just go back to home
    handshakePeerRef.current = null;
    resetHandshake();
    setCurrentView('home');
    setPendingSession(null);
    setActiveIncomingRequest(null);
    clearSearch();
  }, [resetHandshake, clearSearch]);

  // Handle retry handshake
  const handleRetryHandshake = useCallback(() => {
    if (handshakeResult.sessionId && handshakePeerRef.current) {
      startHandshake(handshakeResult.sessionId, handshakePeerRef.current);
    }
  }, [handshakeResult.sessionId, startHandshake]);

  // Subscribe to REQUEST_ACCEPTED for initiator (when our pending request is accepted)
  useEffect(() => {
    if (!isConnected) return;

    const handleRequestAccepted = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body);
        if (data.success && data.sessionId && pendingSession?.id === data.sessionId) {
          // Our pending request was accepted - start handshake
          console.log('[App] Our request was accepted, starting handshake');
          notificationOccurred('success');
          
          // Use the recipient info from pending session (already checked via ?.id above)
          const peer: UserInfo = pendingSession!.recipient;
          handshakePeerRef.current = peer;
          
          startHandshake(data.sessionId, peer);
          setCurrentView('handshake');
          setPendingSession(null);
        }
      } catch (error) {
        console.error('[App] Failed to parse request accepted event:', error);
      }
    };

    // Subscribe to the accepted event for initiator
    const sub = subscribe('/user/queue/request-accepted', handleRequestAccepted);
    
    return () => {
      if (sub) {
        unsubscribe('/user/queue/request-accepted');
      }
    };
  }, [isConnected, subscribe, unsubscribe, pendingSession, startHandshake, notificationOccurred]);

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

  // Pending request view (waiting for recipient to accept)
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

  // Incoming request view (someone wants to chat with us)
  if (currentView === 'incoming-request' && activeIncomingRequest) {
    return (
      <Layout>
        <IncomingRequestView
          request={activeIncomingRequest}
          isAccepting={incomingActionResult.status === 'accepting'}
          isRejecting={incomingActionResult.status === 'rejecting'}
          error={incomingActionResult.error}
          onAccept={handleAcceptRequest}
          onReject={handleRejectRequest}
          onExpire={handleCloseIncomingRequest}
        />
      </Layout>
    );
  }

  // Handshake view (establishing encrypted connection)
  if (currentView === 'handshake') {
    return (
      <Layout>
        <HandshakeView
          result={handshakeResult}
          onCancel={isHandshakeComplete ? handleHandshakeComplete : handleCancelHandshake}
          onRetry={handleRetryHandshake}
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

