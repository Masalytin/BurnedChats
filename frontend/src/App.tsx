import { useEffect, useState, useCallback, useRef } from 'react';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { useSearch } from './hooks/useSearch';
import { useSession, type PendingSession } from './hooks/useSession';
import { useIncomingRequests } from './hooks/useIncomingRequests';
import { useHandshake } from './hooks/useHandshake';
import { useBackButton } from './hooks/useBackButton';
import { useActiveSessions, type ActiveSession } from './hooks/useActiveSessions';
import { Layout } from './components/Layout/Layout';
import { ChatRequestDialog } from './components/ChatRequestDialog';
import { BurnConfirmDialog } from './components/BurnConfirmDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { IncomingRequestView } from './components/IncomingRequestView';
import { HandshakeView } from './components/HandshakeView';
import { ChatRoom } from './components/Chat';
import { ToastProvider, useToast } from './components/Toast';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DebugPanel, debugLog } from './components/DebugPanel';
import { HomePage } from './pages/HomePage';
import { useMessages, type UseMessagesWebSocket } from './hooks/useMessages';
import { burn as burnKeys } from './crypto/keyStore';
import type { UserInfo, ChatRequest } from './types';
import './App.css';

/** Application view states */
type AppView = 'home' | 'pending-request' | 'incoming-request' | 'handshake' | 'chat';

/** Active chat state */
interface ActiveChat {
  sessionId: string;
  peer: UserInfo;
  fingerprint: string;
}

/**
 * Main application content with toast integration
 */
function AppContent() {
  const toast = useToast();
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
    _debug: wsDebug,
  } = useWebSocket({
    onConnect: () => {
      debugLog('success', 'WebSocket connected');
      notificationOccurred('success');
      toast.success('Connected to server');
    },
    onDisconnect: () => {
      debugLog('warn', 'WebSocket disconnected');
    },
    onError: (error) => {
      debugLog('error', 'WebSocket error', error);
      if (error.recoverable) {
        toast.warning('Connection lost. Reconnecting...', { duration: 3000 });
      } else {
        notificationOccurred('error');
        toast.error(error.message, { title: 'Connection Error' });
      }
    },
    onReconnect: () => {
      debugLog('info', 'WebSocket reconnected');
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
      toast.success('Chat request sent!');
      setCurrentView('pending-request');
      setPendingSession(session);
      setShowChatRequestDialog(false);
      setSelectedUser(null);
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Failed to create session: ${errorCode}`, { title: 'Error' });
    },
  });

  // Incoming requests hook
  const {
    requests: incomingRequests,
    actionResult: incomingActionResult,
    acceptRequest,
    rejectRequest,
    clearRequest: clearIncomingRequest,
    resetAction: resetIncomingAction,
  } = useIncomingRequests({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onRequestReceived: (request) => {
      notificationOccurred('success');
      toast.info(`${request.fromName} wants to chat!`, { 
        title: 'New Request',
        duration: 5000,
      });
      // If we're on home, show the incoming request
      if (currentView === 'home') {
        setActiveIncomingRequest(request);
        setCurrentView('incoming-request');
      }
    },
    onSessionAccepted: (sessionId, peer) => {
      // Start handshake after accepting a request (we're the responder)
      notificationOccurred('success');
      toast.success('Request accepted! Establishing secure connection...');
      handshakePeerRef.current = peer;
      startHandshake(sessionId, peer);
      setCurrentView('handshake');
    },
    onOurRequestAccepted: (sessionId, peer) => {
      // Our pending request was accepted (we're the initiator)
      // Only process if we have a matching pending session
      if (pendingSession?.id === sessionId) {
        console.log('[App] Our request was accepted, starting handshake');
        notificationOccurred('success');
        toast.success('Request accepted! Establishing secure connection...');
        handshakePeerRef.current = peer;
        startHandshake(sessionId, peer);
        setCurrentView('handshake');
        setPendingSession(null);
      }
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Request failed: ${errorCode}`, { title: 'Error' });
    },
  });

  // Handshake hook
  const {
    result: handshakeResult,
    startHandshake,
    cancelHandshake,
    reset: resetHandshake,
  } = useHandshake({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onHandshakeComplete: (sessionId, fingerprint) => {
      notificationOccurred('success');
      toast.success('Secure connection established!');
      console.log('[App] Handshake complete:', sessionId, fingerprint);
      // TODO: Navigate to chat view (Sprint 4)
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Handshake failed: ${errorCode}`, { title: 'Connection Error' });
    },
  });

  // Active sessions hook (4.6.5 - 4.6.8)
  const {
    sessions: activeSessions,
    isLoading: isLoadingSessions,
    fetchSessions,
    resumeSession,
    resumeResult,
    resetResume,
  } = useActiveSessions({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    autoFetch: true,
    onSessionResumed: (session) => {
      notificationOccurred('success');
      console.log('[App] Session resumed:', session.sessionId);
      // Store peer info for potential handshake continuation
      const peerInfo: UserInfo = {
        id: session.peer.id,
        username: session.peer.username,
        displayName: session.peer.displayName,
        photoUrl: session.peer.photoUrl,
        online: session.peer.online,
        premium: session.peer.premium,
      };
      handshakePeerRef.current = peerInfo;
      
      // Navigate based on session status
      if (session.status === 'ACTIVE') {
        // Session is active - go directly to chat (TODO: implement chat view)
        toast.success(`Resumed chat with ${session.peer.displayName}`);
        // For now, start handshake to restore connection
        startHandshake(session.sessionId, peerInfo);
        setCurrentView('handshake');
      } else if (session.status === 'HANDSHAKE') {
        // Need to complete handshake
        toast.info('Resuming secure connection...');
        startHandshake(session.sessionId, peerInfo);
        setCurrentView('handshake');
      }
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Failed to resume session: ${errorCode}`, { title: 'Error' });
    },
  });

  // Track which session is being resumed
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);

  // Burn session state (4.6.11)
  const [showBurnDialog, setShowBurnDialog] = useState(false);
  const [burnTargetSession, setBurnTargetSession] = useState<{ sessionId: string; peerName: string } | null>(null);
  const [burningSessionId, setBurningSessionId] = useState<string | null>(null);

  // App state
  const [initError, setInitError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [showChatRequestDialog, setShowChatRequestDialog] = useState(false);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);
  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);

  // Reference to store peer info for handshake
  const handshakePeerRef = useRef<UserInfo | null>(null);
  
  // Active chat state
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  // Back button handling - show when not on home view
  const handleBackButton = useCallback(() => {
    if (showChatRequestDialog) {
      setShowChatRequestDialog(false);
      setSelectedUser(null);
      resetSession();
      return;
    }
    
    if (currentView === 'pending-request') {
      setCurrentView('home');
      setPendingSession(null);
      resetSession();
      clearSearch();
      return;
    }
    
    if (currentView === 'incoming-request') {
      setActiveIncomingRequest(null);
      resetIncomingAction();
      setCurrentView('home');
      return;
    }
    
    if (currentView === 'handshake') {
      // Get the session ID before canceling
      const sessionId = handshakeResult.sessionId;
      
      cancelHandshake();
      handshakePeerRef.current = null;
      setCurrentView('home');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      resetSession();
      clearSearch();
      
      // Burn the session on backend to allow creating new sessions
      if (sessionId && isConnected) {
        console.log('[App] Burning session after handshake cancel (back button):', sessionId);
        publish('/app/session.burn', { sessionId });
        burnKeys(sessionId);
      }
      return;
    }
    
    if (currentView === 'chat') {
      // Just go back to home, don't burn the session
      console.log('[App] Leaving chat via back button');
      setActiveChat(null);
      handshakePeerRef.current = null;
      resetHandshake();
      setCurrentView('home');
      clearSearch();
      fetchSessions();
    }
  }, [
    showChatRequestDialog, 
    currentView, 
    resetSession, 
    clearSearch, 
    resetIncomingAction, 
    cancelHandshake,
    handshakeResult.sessionId,
    isConnected,
    publish,
    resetHandshake,
    fetchSessions,
  ]);

  // Setup back button
  useBackButton({
    visible: currentView !== 'home' || showChatRequestDialog,
    onBack: handleBackButton,
  });

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
    const sessionId = pendingSession?.id;
    setCurrentView('home');
    setPendingSession(null);
    resetSession();
    clearSearch();
    
    // Burn the session on backend to remove the request from the recipient's queue
    // This fixes the bug where the recipient still sees the request after initiator cancels
    if (sessionId && isConnected) {
      console.log('[App] Burning session after pending request cancel:', sessionId);
      publish('/app/session.burn', { sessionId });
      burnKeys(sessionId);
    }
  }, [resetSession, clearSearch, pendingSession, isConnected, publish]);

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
    // Clear the request from the list so it doesn't reappear when returning to home
    if (activeIncomingRequest) {
      clearIncomingRequest(activeIncomingRequest.id);
    }
    setActiveIncomingRequest(null);
    resetIncomingAction();
    setCurrentView('home');
  }, [resetIncomingAction, activeIncomingRequest, clearIncomingRequest]);

  // Handle canceling handshake
  const handleCancelHandshake = useCallback(() => {
    // Get the session ID before canceling
    const sessionId = handshakeResult.sessionId;
    
    // Cancel local handshake state
    cancelHandshake();
    handshakePeerRef.current = null;
    setCurrentView('home');
    setPendingSession(null);
    setActiveIncomingRequest(null);
    resetSession();
    clearSearch();
    
    // Burn the session on backend to allow creating new sessions
    // This is important because the backend still has the session in HANDSHAKE status
    if (sessionId && isConnected) {
      console.log('[App] Burning session after handshake cancel:', sessionId);
      publish('/app/session.burn', { sessionId });
      burnKeys(sessionId);
    }
  }, [cancelHandshake, resetSession, clearSearch, handshakeResult.sessionId, isConnected, publish]);

  // Handle continuing after handshake complete
  const handleHandshakeComplete = useCallback(() => {
    // Navigate to chat view
    const sessionId = handshakeResult.sessionId;
    const peer = handshakePeerRef.current;
    const fingerprint = handshakeResult.fingerprint;
    
    if (sessionId && peer && fingerprint) {
      setActiveChat({ sessionId, peer, fingerprint });
      setCurrentView('chat');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      console.log('[App] Entering chat:', sessionId);
    } else {
      // Fallback to home if something is missing
      console.warn('[App] Missing data for chat, going to home');
      handshakePeerRef.current = null;
      resetHandshake();
      setCurrentView('home');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      fetchSessions();
    }
  }, [handshakeResult.sessionId, handshakeResult.fingerprint, resetHandshake, clearSearch, fetchSessions]);

  // Handle retry handshake
  const handleRetryHandshake = useCallback(() => {
    if (handshakeResult.sessionId && handshakePeerRef.current) {
      startHandshake(handshakeResult.sessionId, handshakePeerRef.current);
    }
  }, [handshakeResult.sessionId, startHandshake]);

  // Handle leaving chat (back to home)
  const handleLeaveChat = useCallback(() => {
    console.log('[App] Leaving chat');
    setActiveChat(null);
    handshakePeerRef.current = null;
    resetHandshake();
    setCurrentView('home');
    clearSearch();
    fetchSessions();
  }, [resetHandshake, clearSearch, fetchSessions]);

  // Handle burn from chat
  const handleBurnFromChat = useCallback(() => {
    if (!activeChat) return;
    setBurnTargetSession({ sessionId: activeChat.sessionId, peerName: activeChat.peer.displayName });
    setShowBurnDialog(true);
    notificationOccurred('warning');
  }, [activeChat, notificationOccurred]);

  // Handle clicking on an active session (4.6.8)
  const handleSessionClick = useCallback((session: ActiveSession) => {
    setResumingSessionId(session.sessionId);
    resumeSession(session.sessionId);
  }, [resumeSession]);

  // Handle burn session from list (4.6.11)
  const handleBurnSessionRequest = useCallback((sessionId: string, peerName: string) => {
    setBurnTargetSession({ sessionId, peerName });
    setShowBurnDialog(true);
    notificationOccurred('warning');
  }, [notificationOccurred]);

  // Confirm burn session (4.6.11)
  const handleConfirmBurn = useCallback(() => {
    if (!burnTargetSession || !isConnected) return;

    setBurningSessionId(burnTargetSession.sessionId);
    setShowBurnDialog(false);
    
    // Send burn request to server
    publish('/app/session.burn', { sessionId: burnTargetSession.sessionId });
    console.log('[App] Burn request sent for session:', burnTargetSession.sessionId);
  }, [burnTargetSession, isConnected, publish]);

  // Cancel burn dialog (4.6.11)
  const handleCancelBurn = useCallback(() => {
    setShowBurnDialog(false);
    setBurnTargetSession(null);
  }, []);

  // Reset resuming state when resume completes
  useEffect(() => {
    if (resumeResult) {
      setResumingSessionId(null);
      if (!resumeResult.success) {
        // Keep on home screen, error is shown via toast
        resetResume();
      }
    }
  }, [resumeResult, resetResume]);

  // Note: REQUEST_ACCEPTED for initiator is now handled via onOurRequestAccepted callback
  // in useIncomingRequests hook (listening to /user/queue/session-accepted)

  // When returning to home view, check for unhandled incoming requests
  // This handles: (1) requests that arrived while on another view, (2) requests from offline period
  useEffect(() => {
    if (currentView === 'home' && !activeIncomingRequest && incomingRequests.length > 0) {
      // Filter out expired requests
      const now = Date.now();
      const validRequests = incomingRequests.filter(r => r.expiresAt > now);
      
      if (validRequests.length > 0) {
        const request = validRequests[0];
        console.log('[App] Showing pending incoming request:', request.id);
        setActiveIncomingRequest(request);
        setCurrentView('incoming-request');
      } else {
        // Clean up expired requests
        incomingRequests.forEach(r => clearIncomingRequest(r.id));
      }
    }
  }, [currentView, activeIncomingRequest, incomingRequests, clearIncomingRequest]);

  // Refs for burn-signal handler dependencies — avoids re-subscription on every state change
  const burnSignalDepsRef = useRef({
    currentView, activeChat, activeIncomingRequest, pendingSession,
    handshakeSessionId: handshakeResult.sessionId,
    fetchSessions, notificationOccurred, toast,
    resetHandshake, cancelHandshake, clearIncomingRequest,
  });
  useEffect(() => {
    burnSignalDepsRef.current = {
      currentView, activeChat, activeIncomingRequest, pendingSession,
      handshakeSessionId: handshakeResult.sessionId,
      fetchSessions, notificationOccurred, toast,
      resetHandshake, cancelHandshake, clearIncomingRequest,
    };
  });

  // Subscribe to BURN_SIGNAL for session list burn (4.6.11)
  // Uses refs for handler deps so the subscription stays stable (no unnecessary UNSUBSCRIBE/SUBSCRIBE cycles)
  useEffect(() => {
    if (!isConnected) return;

    const handleBurnSignal = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body);
        const deps = burnSignalDepsRef.current;
        
        if (data.success && data.sessionId) {
          // Session was burned successfully
          console.log('[App] Session burned:', data.sessionId);
          
          // Clean up local crypto keys
          burnKeys(data.sessionId);
          
          // Reset burn state
          setBurningSessionId(null);
          setBurnTargetSession(null);
          
          // Clean up incoming request if it matches the burned session
          // This handles the case where the initiator cancels and the recipient has the request open
          deps.clearIncomingRequest(data.sessionId);
          if (deps.activeIncomingRequest?.id === data.sessionId) {
            setActiveIncomingRequest(null);
            if (deps.currentView === 'incoming-request') {
              setCurrentView('home');
            }
          }
          
          // Clean up pending session if it matches the burned session
          if (deps.pendingSession?.id === data.sessionId) {
            setPendingSession(null);
            if (deps.currentView === 'pending-request') {
              setCurrentView('home');
            }
          }
          
          // If we're in chat view for this session, go back to home
          if (deps.currentView === 'chat' && deps.activeChat?.sessionId === data.sessionId) {
            setActiveChat(null);
            handshakePeerRef.current = null;
            deps.resetHandshake();
            setCurrentView('home');
          }
          
          // If we're in handshake view for this session, go back to home
          if (deps.currentView === 'handshake' && deps.handshakeSessionId === data.sessionId) {
            deps.cancelHandshake();
            handshakePeerRef.current = null;
            setCurrentView('home');
          }
          
          // Refresh sessions list
          deps.fetchSessions();
          
          // Show notification
          deps.notificationOccurred('success');
          deps.toast.success('Session burned successfully');
        } else if (!data.success && data.error) {
          // Burn failed
          console.error('[App] Burn failed:', data.error);
          setBurningSessionId(null);
          deps.notificationOccurred('error');
          deps.toast.error(`Failed to burn session: ${data.error}`, { title: 'Error' });
        }
      } catch (error) {
        console.error('[App] Failed to parse burn signal:', error);
        setBurningSessionId(null);
      }
    };

    subscribe('/user/queue/burn-signal', handleBurnSignal);
    
    return () => {
      unsubscribe('/user/queue/burn-signal');
    };
  }, [isConnected, subscribe, unsubscribe]);

  // Loading state
  if (!isReady) {
    return <LoadingOverlay message="Loading BurnedChats..." />
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

  // Debug panel props (shared across all views)
  const debugPanelElement = (
    <DebugPanel
      isConnected={isConnected}
      isConnecting={isConnecting}
      reconnectAttempt={reconnectAttempt}
      wsError={wsError}
      activeSubscriptions={wsDebug.activeSubscriptions}
      storedSubscriptions={wsDebug.storedSubscriptions}
      sessionResult={sessionResult}
      handshakeResult={handshakeResult}
    />
  );

  // Pending request view (waiting for recipient to accept)
  if (currentView === 'pending-request' && pendingSession) {
    return (
      <>
        <Layout>
          <PendingRequestView
            session={pendingSession}
            onCancel={handleCancelPendingRequest}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Incoming request view (someone wants to chat with us)
  if (currentView === 'incoming-request' && activeIncomingRequest) {
    return (
      <>
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
        {debugPanelElement}
      </>
    );
  }

  // Handshake view (establishing encrypted connection)
  if (currentView === 'handshake') {
    return (
      <>
        <Layout>
          <HandshakeView
            result={handshakeResult}
            onCancel={handleCancelHandshake}
            onContinue={handleHandshakeComplete}
            onRetry={handleRetryHandshake}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Chat view (active chat)
  if (currentView === 'chat' && activeChat && user) {
    return (
      <>
        <Layout>
          <ChatViewContent
            sessionId={activeChat.sessionId}
            peer={activeChat.peer}
            userId={user.id}
            ws={{ isConnected, subscribe, unsubscribe, publish }}
            onBack={handleLeaveChat}
            onBurn={handleBurnFromChat}
          />
        </Layout>
        {debugPanelElement}
        
        {/* Burn confirm dialog (4.6.11) */}
        {showBurnDialog && burnTargetSession && (
          <BurnConfirmDialog
            peerName={burnTargetSession.peerName}
            isLoading={burningSessionId === burnTargetSession.sessionId}
            onConfirm={handleConfirmBurn}
            onCancel={handleCancelBurn}
          />
        )}
      </>
    );
  }

  // Default: Home view
  return (
    <>
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
          activeSessions={activeSessions}
          isLoadingSessions={isLoadingSessions}
          onSessionClick={handleSessionClick}
          resumingSessionId={resumingSessionId}
          onRefreshSessions={fetchSessions}
          onBurnSession={handleBurnSessionRequest}
          burningSessionId={burningSessionId}
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

        {/* Burn confirm dialog (4.6.11) */}
        {showBurnDialog && burnTargetSession && (
          <BurnConfirmDialog
            peerName={burnTargetSession.peerName}
            isLoading={burningSessionId === burnTargetSession.sessionId}
            onConfirm={handleConfirmBurn}
            onCancel={handleCancelBurn}
          />
        )}
      </Layout>
      {debugPanelElement}
    </>
  );
}

/**
 * Chat view content with useMessages hook
 */
interface ChatViewContentProps {
  sessionId: string;
  peer: UserInfo;
  userId: number;
  ws: UseMessagesWebSocket;
  onBack: () => void;
  onBurn: () => void;
}

function ChatViewContent({ sessionId, peer, userId, ws, onBack, onBurn }: ChatViewContentProps) {
  // Memoize onError callback to prevent unnecessary re-renders
  const handleMessageError = useCallback((err: string, details?: string) => {
    console.error('[ChatViewContent] Message error:', err, details);
  }, []);

  const { messages, sendMessage, isLoading, error } = useMessages({
    sessionId,
    userId,
    ws,
    onError: handleMessageError,
  });

  const handleSendMessage = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  return (
    <ChatRoom
      sessionId={sessionId}
      peer={peer}
      messages={messages}
      isLoading={isLoading}
      isVerified={true}
      onSendMessage={handleSendMessage}
      onBack={onBack}
      onBurn={onBurn}
      disabled={!!error}
    />
  );
}

/**
 * App wrapper with providers
 */
function App() {
  return (
    <ToastProvider position="bottom" maxToasts={3}>
      <AppContent />
    </ToastProvider>
  );
}

export default App;

