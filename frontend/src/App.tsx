import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { useSearch } from './hooks/useSearch';
import { useSession, type PendingSession } from './hooks/useSession';
import { useIncomingRequests } from './hooks/useIncomingRequests';
import { useHandshake } from './hooks/useHandshake';
import { useBackButton } from './hooks/useBackButton';
import { useActiveSessions, type ActiveSession } from './hooks/useActiveSessions';
import { useCreateRoom, type RoomJoinMode } from './hooks/useCreateRoom';
import { useJoinRoom } from './hooks/useJoinRoom';
import { useMyRooms } from './hooks/useMyRooms';
import { useRoomJoinRequests } from './hooks/useRoomJoinRequests';
import { useKeyBundle } from './hooks/useKeyBundle';
import { useRekeyRoom } from './hooks/useRekeyRoom';
import { useGetInviteLink } from './hooks/useGetInviteLink';
import { useRoomMembers } from './hooks/useRoomMembers';
import { Layout } from './components/Layout/Layout';
import { ChatRequestDialog } from './components/ChatRequestDialog';
import { BurnConfirmDialog } from './components/BurnConfirmDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { IncomingRequestView } from './components/IncomingRequestView';
import { HandshakeView } from './components/HandshakeView';
import { ChatRoom } from './components/Chat';
import { RoomChatRoom } from './components/Chat/RoomChatRoom';
import { CreateRoomView, RoomCreatedSuccess } from './components/CreateRoomView';
import { JoinRoomView } from './components/JoinRoomView';
import { RoomJoinRequestsView } from './components/RoomJoinRequestsView';
import { RoomManageView } from './components/RoomManageView';
import { ToastProvider, useToast } from './components/Toast';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DebugPanel, debugLog } from './components/DebugPanel';
import { HomePage } from './pages/HomePage';
import { useMessages, type UseMessagesWebSocket } from './hooks/useMessages';
import { burn as burnKeys, burnGroupKey } from './crypto/keyStore';
import { LandingPage } from './pages/LandingPage';
import type { UserInfo, ChatRequest } from './types';
import './App.css';

/** Application view states */
type AppView =
  | 'home'
  | 'pending-request'
  | 'incoming-request'
  | 'handshake'
  | 'chat'
  | 'create-room'
  | 'join-room'
  | 'room-join-requests'
  | 'room-chat'
  | 'room-manage';

/** Active room chat state */
interface ActiveRoomChat {
  roomId: string;
  epoch: number;
}

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
  const { t } = useTranslation();
  const { 
    isReady, 
    isInTelegram,
    user, 
    expand, 
    setClosingConfirmation, 
    setHeaderColor,
    notificationOccurred,
    startParam,
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
    keyRefreshSessionId,
    clearKeyRefresh,
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

  // Create room hook
  const {
    result: createRoomResult,
    createRoom,
    reset: resetCreateRoom,
    isCreating: isCreatingRoom,
  } = useCreateRoom({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onCreated: () => {
      notificationOccurred('success');
      toast.success('Room created!');
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Failed to create room: ${errorCode}`, { title: 'Error' });
    },
  });

  // Join room hook (P2-2.2.4)
  const {
    result: joinRoomResult,
    loadInviteInfo,
    submitJoin,
    reset: resetJoinRoom,
  } = useJoinRoom({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onApproved: (roomId) => {
      notificationOccurred('success');
      toast.success('Joined room! Waiting for encryption key…');
      console.log('[App] Joined room:', roomId, '— waiting for KEY_BUNDLE');
      // Navigation to room-chat happens in useKeyBundle.onKeyReceived (P2-3.2.3)
    },
    onRejected: () => {
      notificationOccurred('error');
      toast.info('Your join request was rejected.');
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(`Join failed: ${errorCode}`, { title: 'Error' });
    },
  });

  // Room join requests hook (P2-2.2.5) — owner side
  const {
    requests: joinRequests,
    pendingCount: pendingJoinCount,
    acceptRequest: acceptJoinRequest,
    rejectRequest: rejectJoinRequest,
    removeRequest: removeJoinRequest,
  } = useRoomJoinRequests({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onNewRequest: (request) => {
      notificationOccurred('success');
      const name = request.senderUsername ? `@${request.senderUsername}` : request.senderFirstName;
      toast.info(`${name} wants to join the room`, { title: 'Join Request', duration: 5000 });
    },
  });

  // KEY_BUNDLE hook (P2-3.2.3): subscribe, decrypt, store group key → navigate to room-chat
  useKeyBundle({
    isConnected,
    subscribe,
    unsubscribe,
    onKeyReceived: (roomId, epoch) => {
      debugLog('success', `[KeyBundle] Group key received for room ${roomId} epoch ${epoch}`);
      notificationOccurred('success');
      toast.success('Room key received!');
      setActiveRoomChat({ roomId, epoch });
      setCurrentView('room-chat');
    },
    onError: (roomId, error) => {
      debugLog('error', `[KeyBundle] Failed to unwrap key for room ${roomId}: ${error}`);
      if (error === 'NO_PRIVATE_KEY') {
        toast.warning('Missing room key pair — cannot decrypt group key.');
      } else {
        toast.error('Failed to receive room encryption key.', { title: 'Key Error' });
      }
    },
  });

  // ROOM_REKEY hook (P2-3.2.3): owner rotates key; members receive new KEY_BUNDLE via useKeyBundle
  const { rekeyRoom } = useRekeyRoom({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    myTgId: user?.id ?? null,
    onRekeyCompleted: (roomId, newEpoch) => {
      debugLog('success', `[Rekey] Rekey completed for room ${roomId} epoch ${newEpoch}`);
      // Update epoch for the active room chat
      setActiveRoomChat(prev =>
        prev?.roomId === roomId ? { ...prev, epoch: newEpoch } : prev
      );
    },
    onRekeyReceived: (roomId, newEpoch) => {
      debugLog('info', `[Rekey] ROOM_REKEY received: room ${roomId} new epoch ${newEpoch}`);
      // New KEY_BUNDLE is en route — useKeyBundle will handle the actual key update
      toast.info('Room key is being rotated…', { duration: 2000 });
    },
  });

  // Invite link hook (P2-4.3.1)
  const {
    inviteUrl,
    isLoading: isInviteLoading,
    error: inviteError,
    getInviteLink,
    reset: resetInviteLink,
  } = useGetInviteLink({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  // Room members hook (P2-4.3.1)
  const {
    members: roomMembers,
    isLoading: isMembersLoading,
    fetchMembers,
  } = useRoomMembers({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  // Track which requests are being processed (for loading state)
  const [processingJoinKeys, setProcessingJoinKeys] = useState<Set<string>>(new Set());

  // My rooms hook (P2-4.1.2)
  const {
    rooms: myRooms,
    isLoading: isLoadingRooms,
  } = useMyRooms({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
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

  // Invite token state (P2-2.1.3)
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Active room ID for the requests view (P2-2.2.5)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // Track which view to return to from room-join-requests (P2-4.3.1)
  const [requestsReturnView, setRequestsReturnView] = useState<'home' | 'create-room' | 'room-manage'>('home');

  // Active room chat state (P2-3.2.3)
  const [activeRoomChat, setActiveRoomChat] = useState<ActiveRoomChat | null>(null);

  // Track which session is being resumed
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);

  // Burn session state (4.6.11)
  const [showBurnDialog, setShowBurnDialog] = useState(false);
  const [burnTargetSession, setBurnTargetSession] = useState<{ sessionId: string; peerName: string } | null>(null);
  const [burningSessionId, setBurningSessionId] = useState<string | null>(null);

  // App state
  const [initError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [showChatRequestDialog, setShowChatRequestDialog] = useState(false);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);
  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);

  // Reference to store peer info for handshake
  const handshakePeerRef = useRef<UserInfo | null>(null);
  
  // Active chat state
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  // Ref for activeChat to use in key refresh effect without causing re-subscriptions
  const activeChatRef = useRef<ActiveChat | null>(null);
  useEffect(() => { activeChatRef.current = activeChat; });

  // Back button handling - show when not on home view
  const handleBackButton = useCallback(() => {
    if (showChatRequestDialog) {
      setShowChatRequestDialog(false);
      setSelectedUser(null);
      resetSession();
      return;
    }

    if (currentView === 'create-room') {
      resetCreateRoom();
      setCurrentView('home');
      return;
    }

    if (currentView === 'join-room') {
      resetJoinRoom();
      setInviteToken(null);
      setCurrentView('home');
      return;
    }

    if (currentView === 'room-join-requests') {
      setActiveRoomId(null);
      setCurrentView(requestsReturnView);
      setRequestsReturnView('home');
      return;
    }

    if (currentView === 'room-manage') {
      resetInviteLink();
      setCurrentView('room-chat');
      return;
    }

    if (currentView === 'room-chat') {
      setActiveRoomChat(null);
      setCurrentView('home');
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
    resetCreateRoom,
    resetJoinRoom,
    clearSearch,
    resetIncomingAction,
    cancelHandshake,
    handshakeResult.sessionId,
    isConnected,
    publish,
    resetHandshake,
    fetchSessions,
    createRoomResult.status,
    resetInviteLink,
    requestsReturnView,
  ]);

  // Show back button on all non-home views
  useBackButton({
    visible: currentView !== 'home' || showChatRequestDialog,
    onBack: handleBackButton,
  });

  // Expose rekeyRoom for future use (owner rekey after member leaves — P2-4.3.4)
  // Ref ensures the callback is stable and doesn't cause re-renders
  const rekeyRoomRef = useRef(rekeyRoom);
  useEffect(() => { rekeyRoomRef.current = rekeyRoom; }, [rekeyRoom]);


  // Handle "Create Room" click from HomePage
  const handleCreateRoom = useCallback(() => {
    resetCreateRoom();
    setCurrentView('create-room');
  }, [resetCreateRoom]);

  // Handle room card click from HomePage (P2-4.1.2)
  const handleRoomClick = useCallback((roomId: string) => {
    setActiveRoomChat({ roomId, epoch: 0 });
    setCurrentView('room-chat');
  }, []);

  // Handle opening room management (P2-4.3.1) — owner only
  const handleOpenRoomManage = useCallback(() => {
    resetInviteLink();
    setCurrentView('room-manage');
  }, [resetInviteLink]);

  // Handle burn room from manage view (P2-4.3.2 / P2-4.3.3)
  const handleBurnRoom = useCallback(() => {
    if (!activeRoomChat || !isConnected) return;
    publish('/app/room.burn', { roomId: activeRoomChat.roomId });
    debugLog('info', `[RoomManage] BURN_ROOM sent for ${activeRoomChat.roomId}`);
    // ROOM_BURNED response handled in the subscription above (fires for all members)
  }, [activeRoomChat, isConnected, publish]);

  // Handle "View Requests" from RoomCreatedSuccess
  const handleViewRequests = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    setRequestsReturnView('create-room');
    setCurrentView('room-join-requests');
  }, []);

  // Handle accept/reject join request (P2-2.2.5)
  const handleAcceptJoinRequest = useCallback((roomId: string, senderTgId: number) => {
    const key = `${roomId}:${senderTgId}`;
    setProcessingJoinKeys(prev => new Set(prev).add(key));
    acceptJoinRequest(roomId, senderTgId);
    // Optimistically remove from list after a short delay
    setTimeout(() => {
      removeJoinRequest(roomId, senderTgId);
      setProcessingJoinKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      notificationOccurred('success');
      toast.success('Request accepted');
    }, 500);
  }, [acceptJoinRequest, removeJoinRequest, notificationOccurred, toast]);

  const handleRejectJoinRequest = useCallback((roomId: string, senderTgId: number) => {
    const key = `${roomId}:${senderTgId}`;
    setProcessingJoinKeys(prev => new Set(prev).add(key));
    rejectJoinRequest(roomId, senderTgId);
    // Optimistically remove from list after a short delay
    setTimeout(() => {
      removeJoinRequest(roomId, senderTgId);
      setProcessingJoinKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast.info('Request rejected');
    }, 500);
  }, [rejectJoinRequest, removeJoinRequest, toast]);

  // Handle CreateRoomView form submit
  const handleCreateRoomSubmit = useCallback((password: string, joinMode: RoomJoinMode) => {
    createRoom(password, joinMode);
  }, [createRoom]);

  // Handle invite deep link from startapp parameter (P2-2.1.3)
  // startParam format: "invite_{token}" → route to join-room view
  useEffect(() => {
    if (!isReady) return;
    if (!startParam) return;
    if (!startParam.startsWith('invite_')) return;

    const token = startParam.slice('invite_'.length);
    if (!token) return;

    resetJoinRoom();
    setInviteToken(token);
    setCurrentView('join-room');
    // Load invite info once connected; if not connected yet, loadInviteInfo
    // will be called again when handleJoinByToken is re-triggered or user retries.
    if (isConnected) {
      loadInviteInfo(token);
    }
  }, [isReady, startParam, isConnected, resetJoinRoom, loadInviteInfo]);

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

    // In production, require Telegram environment — landing page handles this case
    if (import.meta.env.PROD && !isInTelegram) {
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

  // Handle leaving room (non-owner) (P2-4.3.4)
  const handleLeaveRoom = useCallback(() => {
    if (!activeRoomChat || !isConnected) return;
    publish('/app/room.leave', { roomId: activeRoomChat.roomId });
    debugLog('info', `[RoomChat] LEAVE_ROOM sent for ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, publish]);

  // Refs for ROOM_BURNED handler dependencies — avoids re-subscription on state changes
  const roomBurnedDepsRef = useRef({
    currentView,
    activeRoomChat,
    notificationOccurred,
    toast,
  });
  useEffect(() => {
    roomBurnedDepsRef.current = {
      currentView,
      activeRoomChat,
      notificationOccurred,
      toast,
    };
  });

  // Subscribe to ROOM_BURNED — handles server-side room destruction (P2-4.3.2 / P2-4.3.3)
  // Triggered for all room members (including owner) when the owner calls BURN_ROOM
  useEffect(() => {
    if (!isConnected) return;

    const handleRoomBurned = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body) as {
          success: boolean;
          roomId?: string;
          error?: string;
        };
        const deps = roomBurnedDepsRef.current;

        if (data.success && data.roomId) {
          const roomId = data.roomId;

          // Securely destroy the group key from memory
          burnGroupKey(roomId);

          // If currently in room-chat or room-manage for this room, navigate to home
          const isViewingRoom =
            (deps.currentView === 'room-chat' || deps.currentView === 'room-manage') &&
            deps.activeRoomChat?.roomId === roomId;

          if (isViewingRoom) {
            setActiveRoomChat(null);
            setCurrentView('home');
          }

          deps.notificationOccurred('success');
          deps.toast.success(t('room.burned'));
        } else if (!data.success && data.error) {
          deps.notificationOccurred('error');
          deps.toast.error(`Failed to burn room: ${data.error}`, { title: 'Error' });
        }
      } catch (err) {
        console.error('[App] Failed to parse ROOM_BURNED event:', err);
      }
    };

    subscribe('/user/queue/room-burned', handleRoomBurned);

    return () => {
      unsubscribe('/user/queue/room-burned');
    };
  }, [isConnected, subscribe, unsubscribe, t]);

  // Refs for ROOM_LEFT / ROOM_MEMBER_LEFT handler dependencies
  const roomLeftDepsRef = useRef({
    currentView,
    activeRoomChat,
    myRooms,
    notificationOccurred,
    toast,
  });
  useEffect(() => {
    roomLeftDepsRef.current = {
      currentView,
      activeRoomChat,
      myRooms,
      notificationOccurred,
      toast,
    };
  });

  // Subscribe to ROOM_LEFT — leaver receives confirmation (P2-4.3.4)
  useEffect(() => {
    if (!isConnected) return;

    const handleRoomLeft = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body) as {
          success: boolean;
          roomId?: string;
          error?: string;
        };
        const deps = roomLeftDepsRef.current;

        if (data.success && data.roomId) {
          const roomId = data.roomId;

          burnGroupKey(roomId);

          const isViewingRoom =
            (deps.currentView === 'room-chat' || deps.currentView === 'room-manage') &&
            deps.activeRoomChat?.roomId === roomId;

          if (isViewingRoom) {
            setActiveRoomChat(null);
            setCurrentView('home');
          }

          deps.notificationOccurred('success');
          deps.toast.success(t('room.left'));
        } else if (!data.success && data.error) {
          deps.notificationOccurred('error');
          deps.toast.error(`Failed to leave room: ${data.error}`, { title: 'Error' });
        }
      } catch (err) {
        console.error('[App] Failed to parse ROOM_LEFT event:', err);
      }
    };

    subscribe('/user/queue/room-left', handleRoomLeft);

    return () => {
      unsubscribe('/user/queue/room-left');
    };
  }, [isConnected, subscribe, unsubscribe, t]);

  // Subscribe to ROOM_MEMBER_LEFT — remaining members (owner) receive this to trigger rekey (P2-4.3.4)
  useEffect(() => {
    if (!isConnected) return;

    const handleRoomMemberLeft = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body) as {
          roomId?: string;
          leftTgId?: number;
        };
        const deps = roomLeftDepsRef.current;

        if (!data.roomId) return;

        const roomId = data.roomId;
        const isOwner = deps.myRooms.find(r => r.roomId === roomId)?.role === 'owner';

        debugLog('info', `[RoomChat] ROOM_MEMBER_LEFT: room=${roomId}, leftTgId=${data.leftTgId}, isOwner=${isOwner}`);

        if (isOwner) {
          // Owner must rotate the group key so the departed member loses access
          rekeyRoomRef.current(roomId);
        }
      } catch (err) {
        console.error('[App] Failed to parse ROOM_MEMBER_LEFT event:', err);
      }
    };

    subscribe('/user/queue/room-member-left', handleRoomMemberLeft);

    return () => {
      unsubscribe('/user/queue/room-member-left');
    };
  }, [isConnected, subscribe, unsubscribe]);

  // Handle key refresh notifications (peer reconnected and needs re-handshake)
  // When the peer sends a new key for an ACTIVE session, the server notifies us
  // that we need to participate in the key refresh by also generating and sending new keys.
  useEffect(() => {
    if (!keyRefreshSessionId) return;
    
    // Clear the notification immediately to prevent re-processing
    clearKeyRefresh();
    
    const chat = activeChatRef.current;
    if (chat?.sessionId === keyRefreshSessionId) {
      // We're currently in the chat for this session - auto-start handshake with forceRefresh
      // This generates new keys and sends them to the server without switching to handshake view
      console.log('[App] Auto key refresh for active chat:', keyRefreshSessionId);
      handshakePeerRef.current = chat.peer;
      startHandshake(keyRefreshSessionId, chat.peer, true);
    } else {
      console.log('[App] Key refresh notification for non-active chat, ignoring:', keyRefreshSessionId);
    }
  }, [keyRefreshSessionId, clearKeyRefresh, startHandshake]);

  // Loading state
  if (!isReady) {
    return <LoadingOverlay message="Loading BurnedChats..." />
  }

  // Landing page for non-Telegram browsers (in production, or via ?landing query param in dev)
  const showLanding = import.meta.env.PROD ? !isInTelegram : new URLSearchParams(window.location.search).has('landing');
  if (showLanding) {
    return <LandingPage />;
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

  // Create room view
  if (currentView === 'create-room') {
    return (
      <>
        <Layout>
          {createRoomResult.status === 'created' && createRoomResult.roomId ? (
            <RoomCreatedSuccess
              roomId={createRoomResult.roomId}
              inviteLink={createRoomResult.inviteUrl}
              onViewRequests={handleViewRequests}
              pendingRequestsCount={pendingJoinCount}
              onEnterRoom={() => {
                resetCreateRoom();
                setCurrentView('home');
              }}
            />
          ) : (
            <CreateRoomView
              isLoading={isCreatingRoom}
              error={createRoomResult.error}
              onSubmit={handleCreateRoomSubmit}
              onCancel={() => {
                resetCreateRoom();
                setCurrentView('home');
              }}
            />
          )}
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Join room view (opened via Telegram invite deep link) — P2-2.2.4
  if (currentView === 'join-room' && inviteToken) {
    return (
      <>
        <Layout>
          <JoinRoomView
            token={inviteToken}
            status={joinRoomResult.status}
            joinMode={joinRoomResult.joinMode}
            error={joinRoomResult.error}
            onSubmit={(token, password) => submitJoin(token, password)}
            onCancel={() => {
              resetJoinRoom();
              setInviteToken(null);
              setCurrentView('home');
            }}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Room join requests view (owner manages pending requests) — P2-2.2.5
  if (currentView === 'room-join-requests') {
    // Show requests for the active room, or all requests if no specific room
    const visibleRequests = activeRoomId
      ? joinRequests.filter(r => r.roomId === activeRoomId)
      : joinRequests;

    return (
      <>
        <Layout>
          <RoomJoinRequestsView
            requests={visibleRequests}
            processingKeys={processingJoinKeys}
            onAccept={handleAcceptJoinRequest}
            onReject={handleRejectJoinRequest}
            onBack={() => {
              setActiveRoomId(null);
              setCurrentView(requestsReturnView);
              setRequestsReturnView('home');
            }}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Room chat view (P2-4.2.2) — entered after KEY_BUNDLE received
  if (currentView === 'room-chat' && activeRoomChat && user) {
    const activeRoom = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    const isRoomOwner = activeRoom?.role === 'owner';

    return (
      <>
        <Layout>
          <RoomChatRoom
            roomId={activeRoomChat.roomId}
            epoch={activeRoomChat.epoch}
            userId={user.id}
            ws={{ isConnected, subscribe, unsubscribe, publish }}
            isOwner={isRoomOwner}
            onBack={() => {
              setActiveRoomChat(null);
              setCurrentView('home');
            }}
            onManage={isRoomOwner ? handleOpenRoomManage : undefined}
            onLeave={!isRoomOwner ? handleLeaveRoom : undefined}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Room manage view (P2-4.3.1) — owner only
  if (currentView === 'room-manage' && activeRoomChat) {
    return (
      <>
        <Layout>
          <RoomManageView
            roomId={activeRoomChat.roomId}
            isOwner
            pendingRequestsCount={pendingJoinCount}
            members={roomMembers}
            isMembersLoading={isMembersLoading}
            inviteUrl={inviteUrl}
            isInviteLoading={isInviteLoading}
            inviteError={inviteError}
            onBack={() => {
              resetInviteLink();
              setCurrentView('room-chat');
            }}
            onGetInviteLink={() => getInviteLink(activeRoomChat.roomId)}
            onViewRequests={() => {
              setActiveRoomId(activeRoomChat.roomId);
              setRequestsReturnView('room-manage');
              setCurrentView('room-join-requests');
            }}
            onFetchMembers={() => fetchMembers(activeRoomChat.roomId)}
            onBurnRoom={handleBurnRoom}
          />
        </Layout>
        {debugPanelElement}
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
          onCreateRoom={handleCreateRoom}
          rooms={myRooms}
          isLoadingRooms={isLoadingRooms}
          onRoomClick={handleRoomClick}
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

