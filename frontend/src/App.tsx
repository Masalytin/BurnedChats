import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, Routes, Route } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import { AuthContextProvider } from './auth';
import { AuthType } from './auth/types';
import { getEnvironment } from './env/detector';
import { useAuth } from './hooks/useAuth';
import { useTelegram } from './hooks/useTelegram';
import { useTelegramViewport } from './hooks/useTelegramViewport';
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
import { useRequestKeyBundle } from './hooks/useRequestKeyBundle';
import { useGetInviteLink } from './hooks/useGetInviteLink';
import { useRoomMembers } from './hooks/useRoomMembers';
import { Layout } from './components/Layout/Layout';
import { BottomNavBar, type BottomNavItem } from './components/BottomNavBar';
import { HomeIcon, WalletIcon, SettingsGearIcon } from './icons';
import { ChatRequestDialog, type ChatRequestSecretPayload } from './components/ChatRequestDialog';
import { WalletLoginScreen } from './components/Auth/WalletLoginScreen';
import { BurnConfirmDialog } from './components/BurnConfirmDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { IncomingRequestView } from './components/IncomingRequestView';
import { HandshakeView } from './components/HandshakeView';
import { ChatRoom } from './components/Chat';
import { RoomChatRoom } from './components/Chat/RoomChatRoom';
import { CreateRoomView } from './components/CreateRoomView';
import { JoinRoomView } from './components/JoinRoomView';
import { RoomJoinRequestsView } from './components/RoomJoinRequestsView';
import { RoomManageView } from './components/RoomManageView';
import { ToastProvider, useToast } from './components/Toast';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DebugPanel, debugLog } from './components/DebugPanel';
import { HomePage } from './pages/HomePage';
import { WalletPage } from './pages/WalletPage';
import { SettingsPage } from './pages/SettingsPage';
import { CreateProposal } from './components/Governance/CreateProposal';
import { ProposalDetail } from './components/Governance/ProposalDetail';
import { ProposalList } from './components/Governance/ProposalList';
import { GovernancePage } from './pages/GovernancePage';
import { StakingPage } from './pages/StakingPage';
import { LazyWalletChrome } from './components/Wallet/LazyWalletChrome';
import { WalletErrorBoundary } from './components/Wallet/WalletErrorBoundary';
import type { LinkedAccountsCredentials } from './components/Settings/LinkedAccounts';
import { completeTelegramWalletLink } from './services/accountLinkingApi';
import { useMessages, type UseMessagesWebSocket, type MessageErrorCode } from './hooks/useMessages';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { burn as burnKeys, burnGroupKey, hasGroupKey } from './crypto/keyStore';
import { PreferencesProvider, usePreferences } from './preferences';
import { clearDownloadCache } from './services/fileDownloadService';
import { cancelAll } from './services/transferQueue';
import { isFilesErrorI18nKey } from './services/fileTransferErrors';
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
  /** Cached owner flag — used as fallback before myRooms is populated. */
  isOwner?: boolean;
}

/** Active chat state */
interface ActiveChat {
  sessionId: string;
  peer: UserInfo;
  fingerprint: string;
}

/** Bottom navigation tab identifiers */
type TabId = 'home' | 'wallet' | 'settings';

/** Views where bottom nav is hidden (Telegram BackButton handles navigation) */
const IMMERSIVE_VIEWS: AppView[] = [
  'pending-request',
  'incoming-request',
  'handshake',
  'chat',
  'create-room',
  'join-room',
  'room-join-requests',
  'room-chat',
  'room-manage',
];

/**
 * Main application content with toast integration
 */
function AppContent() {
  const toast = useToast();
  const { prefs } = usePreferences();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading, isAuthenticated, getCredentials } = useAuth();
  const { 
    isReady, 
    isInTelegram,
    expand, 
    setClosingConfirmation, 
    setHeaderColor,
    setBottomBarColor,
    notificationOccurred,
    startParam,
  } = useTelegram();

  useTelegramViewport();
  
  const { 
    isConnected,
    isReconnection,
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
    getCredentials,
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

  const myInternalId = user?.internalId ?? null;
  const telegramUserId = user?.telegramId ?? null;
  const environment = getEnvironment();

  const linkedAccountsCredentials = useMemo((): LinkedAccountsCredentials | null => {
    if (!isAuthenticated || !user) {
      return null;
    }
    if (environment === 'telegram') {
      const initData = WebApp.initData ?? '';
      return initData.length > 0 ? { kind: 'telegram', initData } : null;
    }
    const creds = getCredentials();
    if (user.authType === AuthType.WALLET && creds?.sessionToken) {
      return { kind: 'wallet', sessionToken: creds.sessionToken };
    }
    return null;
  }, [isAuthenticated, user, environment, getCredentials]);

  const [telegramWalletChromeRequested, setTelegramWalletChromeRequested] = useState(false);

  const requestTelegramWalletChrome = useCallback(() => {
    setTelegramWalletChromeRequested(true);
  }, []);

  useEffect(() => {
    if (environment !== 'telegram') return;
    if (user?.walletAddress) {
      setTelegramWalletChromeRequested(true);
    }
  }, [environment, user?.walletAddress]);

  useEffect(() => {
    if (environment !== 'telegram') return;
    const p = location.pathname;
    if (p.startsWith('/app/governance') || p.startsWith('/app/staking') || p.startsWith('/app/wallet')) {
      setTelegramWalletChromeRequested(true);
    }
  }, [environment, location.pathname]);

  const telegramWalletLinkAttemptedRef = useRef(false);

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
    onCreated: (room) => {
      notificationOccurred('success');
      toast.success(t('room.create.createdToast'), { duration: 4000 });
      resetCreateRoom();
      setActiveRoomChat({ roomId: room.id, epoch: 0, isOwner: true });
      setCurrentView('room-chat');
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      toast.error(t('room.create.errorToast', { error: errorCode }), {
        title: t('room.create.errorToastTitle'),
      });
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
      toast.success('Joined room! Loading encryption key…');
      console.log('[App] Joined room:', roomId, '— navigating to room-chat, KEY_BUNDLE incoming');
      // Navigate immediately; RoomChatRoom shows a loading state until KEY_BUNDLE arrives.
      // useKeyBundle.onKeyReceived will update the epoch once the key is delivered.
      resetJoinRoom();
      setInviteToken(null);
      setActiveRoomChat({ roomId, epoch: 0 });
      setCurrentView('room-chat');
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
    myId: myInternalId,
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
    fetchRooms,
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
      const peerInfo: UserInfo = session.peer;
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

  // Tracks which invite token was already routed to join-room, preventing
  // the deep-link effect from re-firing (and resetting state) on WS reconnect.
  const inviteSetupTokenRef = useRef<string | null>(null);

  // Active room ID for the requests view (P2-2.2.5)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // Track which view to return to from room-join-requests (P2-4.3.1)
  const [requestsReturnView, setRequestsReturnView] = useState<'home' | 'room-manage'>('home');

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
        cancelAll();
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
    resetInviteLink,
    requestsReturnView,
  ]);

  // Show back button on all non-home views (wallet/settings stay on currentView === 'home')
  useBackButton({
    visible: currentView !== 'home' || showChatRequestDialog,
    onBack: handleBackButton,
  });

  const activeTabId = useMemo((): TabId => {
    const path = location.pathname;
    if (
      path.startsWith('/app/wallet') ||
      path.startsWith('/app/governance') ||
      path === '/app/staking'
    ) {
      return 'wallet';
    }
    if (path.startsWith('/app/settings')) {
      return 'settings';
    }
    return 'home';
  }, [location.pathname]);

  const homeBadgeCount = useMemo(() => {
    const now = Date.now();
    const validIncoming = incomingRequests.filter((request) => request.expiresAt > now).length;
    return validIncoming + pendingJoinCount;
  }, [incomingRequests, pendingJoinCount]);

  const isTopLevelPath = useMemo(() => {
    const path = location.pathname;
    return (
      path.startsWith('/app/wallet') ||
      path.startsWith('/app/governance') ||
      path === '/app/staking' ||
      path.startsWith('/app/settings')
    );
  }, [location.pathname]);

  const showBottomNav =
    !showChatRequestDialog &&
    !IMMERSIVE_VIEWS.includes(currentView) &&
    (isTopLevelPath || currentView === 'home');

  const handleNavSelect = useCallback(
    (id: string) => {
      switch (id) {
        case 'home':
          navigate('/app');
          break;
        case 'wallet':
          navigate('/app/wallet');
          break;
        case 'settings':
          navigate('/app/settings');
          break;
        default:
          break;
      }
    },
    [navigate],
  );

  const handleNavReselect = useCallback(() => {
    document.querySelector('.layout-main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const bottomNavItems = useMemo((): BottomNavItem[] => [
    {
      id: 'home',
      icon: <HomeIcon size={24} />,
      labelKey: 'nav.home',
      badgeCount: homeBadgeCount > 0 ? homeBadgeCount : undefined,
    },
    {
      id: 'wallet',
      icon: <WalletIcon size={24} />,
      labelKey: 'nav.wallet',
    },
    {
      id: 'settings',
      icon: <SettingsGearIcon size={24} />,
      labelKey: 'nav.settings',
    },
  ], [homeBadgeCount]);

  const bottomNavElement = useMemo(
    () => (
      <BottomNavBar
        items={bottomNavItems}
        activeId={activeTabId}
        onSelect={handleNavSelect}
        onReselect={handleNavReselect}
      />
    ),
    [bottomNavItems, activeTabId, handleNavSelect, handleNavReselect],
  );

  const layoutBottomNav = showBottomNav ? bottomNavElement : undefined;

  // Expose rekeyRoom for future use (owner rekey after member leaves — P2-4.3.4)
  // Ref ensures the callback is stable and doesn't cause re-renders
  const rekeyRoomRef = useRef(rekeyRoom);
  useEffect(() => { rekeyRoomRef.current = rekeyRoom; }, [rekeyRoom]);

  // -----------------------------------------------------------------------
  // Key re-distribution on re-entry (P2-3.2.3)
  // -----------------------------------------------------------------------

  // Determine whether the active room needs a key and whether current user is owner
  const activeRoomNeedsKey = activeRoomChat != null && !hasGroupKey(activeRoomChat.roomId);
  const activeRoomIsOwner = (() => {
    if (!activeRoomChat) return false;
    const room = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    return room ? room.role === 'owner' : (activeRoomChat.isOwner ?? false);
  })();

  // Member flow: request KEY_BUNDLE from owner when key is missing
  const { isRequesting: isRequestingKey, retry: retryKeyRequest } = useRequestKeyBundle({
    roomId: activeRoomChat?.roomId ?? null,
    isConnected,
    publish,
    enabled: activeRoomNeedsKey && !activeRoomIsOwner,
  });

  // Owner flow: auto-rekey when entering room without key
  const ownerRekeyTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeRoomNeedsKey || !activeRoomIsOwner || !isConnected) {
      ownerRekeyTriggeredRef.current = null;
      return;
    }
    const roomId = activeRoomChat!.roomId;
    if (ownerRekeyTriggeredRef.current === roomId) return;
    ownerRekeyTriggeredRef.current = roomId;
    debugLog('info', `[App] Owner entering room ${roomId} without key — triggering rekey`);
    rekeyRoomRef.current(roomId);
  }, [activeRoomNeedsKey, activeRoomIsOwner, isConnected, activeRoomChat]);

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

  // Handle accept/reject join request (P2-2.2.5)
  const handleAcceptJoinRequest = useCallback((roomId: string, senderInternalId: string) => {
    const key = `${roomId}:${senderInternalId}`;
    setProcessingJoinKeys(prev => new Set(prev).add(key));
    acceptJoinRequest(roomId, senderInternalId);
    // Optimistically remove from list after a short delay
    setTimeout(() => {
      removeJoinRequest(roomId, senderInternalId);
      setProcessingJoinKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      notificationOccurred('success');
      toast.success('Request accepted');
    }, 500);
  }, [acceptJoinRequest, removeJoinRequest, notificationOccurred, toast]);

  const handleRejectJoinRequest = useCallback((roomId: string, senderInternalId: string) => {
    const key = `${roomId}:${senderInternalId}`;
    setProcessingJoinKeys(prev => new Set(prev).add(key));
    rejectJoinRequest(roomId, senderInternalId);
    // Optimistically remove from list after a short delay
    setTimeout(() => {
      removeJoinRequest(roomId, senderInternalId);
      setProcessingJoinKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast.info('Request rejected');
    }, 500);
  }, [rejectJoinRequest, removeJoinRequest, toast]);

  // Handle CreateRoomView form submit (password may be null for BY_REQUEST without password)
  const handleCreateRoomSubmit = useCallback((password: string | null, joinMode: RoomJoinMode) => {
    createRoom(password, joinMode);
  }, [createRoom]);

  // Handle invite deep link from startapp parameter (P2-2.1.3)
  // startParam format: "invite_{token}" → route to join-room view
  //
  // `isConnected` is kept in deps so loadInviteInfo is called as soon as the
  // WebSocket is ready.  The inviteSetupTokenRef guard ensures the navigation /
  // state-reset block only runs ONCE per token, preventing the effect from
  // kicking the user out of room-chat on WS reconnect.
  useEffect(() => {
    if (!isReady) return;
    if (!startParam) return;
    if (!startParam.startsWith('invite_')) return;

    const token = startParam.slice('invite_'.length);
    if (!token) return;

    if (inviteSetupTokenRef.current !== token) {
      // First time seeing this token — navigate to join-room and reset state.
      inviteSetupTokenRef.current = token;
      resetJoinRoom();
      setInviteToken(token);
      setCurrentView('join-room');
    }

    // Load invite info as soon as we are connected (safe to call idempotently;
    // the hook ignores the response once the form has been submitted).
    if (isConnected) {
      loadInviteInfo(token);
    }
  }, [isReady, startParam, isConnected, resetJoinRoom, loadInviteInfo]);

  // Telegram Mini App completes wallet ↔ Telegram linking (start_param lt_<challenge>)
  useEffect(() => {
    if (!isReady || environment !== 'telegram') return;
    if (!startParam?.startsWith('lt_')) return;
    const challengeId = startParam.slice('lt_'.length);
    if (!/^[a-fA-F0-9]{32}$/.test(challengeId)) return;
    const initData = WebApp.initData;
    if (!initData) return;
    if (telegramWalletLinkAttemptedRef.current) return;
    telegramWalletLinkAttemptedRef.current = true;

    void (async () => {
      try {
        await completeTelegramWalletLink(challengeId, initData);
        notificationOccurred('success');
        toast.success(t('accountLinking.telegramLinkedToast'));
      } catch (err) {
        telegramWalletLinkAttemptedRef.current = false;
        const msg = err instanceof Error ? err.message : t('accountLinking.linkFailed');
        notificationOccurred('error');
        toast.error(msg, { title: t('accountLinking.sectionTitle') });
      }
    })();
  }, [environment, isReady, notificationOccurred, startParam, t, toast]);

  // Initialize Mini App chrome only in Telegram.
  useEffect(() => {
    if (!isReady || !isInTelegram) return;
    expand();
    setClosingConfirmation(true);
    setHeaderColor('secondary_bg_color');
    setBottomBarColor('secondary_bg_color');
  }, [isReady, isInTelegram, expand, setClosingConfirmation, setHeaderColor, setBottomBarColor]);

  /** True after we've seen `isAuthenticated` — used to distinguish cold start vs logout. */
  const wasAuthenticatedRef = useRef(false);

  /**
   * On real logout (`isAuthenticated` false after login), clear stored WS subs via
   * `disconnect(true)`. Do not fire on initial mount while still unauthenticated.
   *
   * For connect-effect cleanup use `disconnect(false)` so subs stay registered for reconnect
   * (`storedSubscriptionsRef` in `useWebSocket`).
   */
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      return;
    }
    if (wasAuthenticatedRef.current) {
      disconnect(true);
      wasAuthenticatedRef.current = false;
    }
  }, [isAuthenticated, disconnect]);

  // Connect to WebSocket only when Telegram auth is available.
  useEffect(() => {
    if (!isReady || !isAuthenticated) return;
    connect();

    return () => {
      // Routine teardown — keep stored subs for back/forward navigation and reconnect.
      // Full wipe runs only via the logout effect above (`disconnect(true)`).
      disconnect(false);
    };
  }, [isReady, isAuthenticated, connect, disconnect]);

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
  const handleSubmitChatRequest = useCallback(
    (secret?: ChatRequestSecretPayload) => {
      if (!selectedUser) return;
      createSession(selectedUser.internalId, secret);
    },
    [selectedUser, createSession]
  );

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
      cancelAll();
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
      cancelAll();
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

  // Auto-refresh rooms and sessions on every navigation back to 'home'
  // useRef(true) skips the initial mount so we don't fire an extra fetch on startup
  const isFirstHomeRender = useRef(true);
  useEffect(() => {
    if (currentView !== 'home') return;
    if (isFirstHomeRender.current) {
      isFirstHomeRender.current = false;
      return;
    }
    fetchRooms();
    fetchSessions();
  }, [currentView, fetchRooms, fetchSessions]);

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
          
          cancelAll();
          // Clean up local crypto keys and cached files
          burnKeys(data.sessionId);
          clearDownloadCache();
          
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
    cancelAll();
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

          cancelAll();
          // Securely destroy the group key and cached files from memory
          burnGroupKey(roomId);
          clearDownloadCache();

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

          cancelAll();
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
          leftInternalId?: string;
          /** @deprecated Prefer leftInternalId. */
          leftTgId?: number;
        };
        const deps = roomLeftDepsRef.current;

        if (!data.roomId) return;

        const roomId = data.roomId;
        const leftMemberId = data.leftInternalId?.trim()
          || (data.leftTgId != null ? String(data.leftTgId) : undefined);
        const isOwner = deps.myRooms.find(r => r.roomId === roomId)?.role === 'owner';

        debugLog('info', `[RoomChat] ROOM_MEMBER_LEFT: room=${roomId}, leftInternalId=${leftMemberId}, isOwner=${isOwner}`);

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

  // -----------------------------------------------------------------------
  // FIX-SYNC-3: Re-sync offline messages when Mini App returns from background
  // -----------------------------------------------------------------------
  //
  // When the Mini App is backgrounded (Telegram switched to another tab, OS
  // suspends the webview, etc.), the STOMP connection may stay alive but the
  // server-side `online:{tgId}` TTL (30 s) will lapse. The peer then queues
  // messages into Redis. On return-from-background the WebSocket reports no
  // reconnection, so neither the initial-sync-on-open effect (FIX-SYNC-1) nor
  // the reconnection-based auto-sync (FIX-SYNC-2) fires. We explicitly trigger
  // a sync for the currently active chat / room instead.
  //
  // Sync callbacks are registered via refs by the child views (ChatViewContent /
  // RoomChatRoom) so the logic stays colocated with the hook that owns it.
  const dmSyncMessagesRef = useRef<(() => void) | null>(null);
  const roomSyncMessagesRef = useRef<(() => void) | null>(null);

  // Debounce: do not trigger sync more than once per 5 seconds. Prevents
  // spurious floods when users rapidly toggle between tabs.
  const lastVisibilitySyncAtRef = useRef(0);
  const MIN_VISIBILITY_SYNC_INTERVAL_MS = 5_000;

  // Keep the latest view/chat state in a ref so the visibility callback can
  // read fresh values without being re-created on every state change.
  const visibilitySyncDepsRef = useRef({
    currentView,
    hasActiveChat: activeChat != null,
    hasActiveRoom: activeRoomChat != null,
    isConnected,
  });
  useEffect(() => {
    visibilitySyncDepsRef.current = {
      currentView,
      hasActiveChat: activeChat != null,
      hasActiveRoom: activeRoomChat != null,
      isConnected,
    };
  });

  const handleVisibilityRestored = useCallback(() => {
    const deps = visibilitySyncDepsRef.current;
    if (!deps.isConnected) return;

    const now = Date.now();
    if (now - lastVisibilitySyncAtRef.current < MIN_VISIBILITY_SYNC_INTERVAL_MS) {
      debugLog('info', '[App] Visibility restored — sync skipped (debounced)');
      return;
    }

    if (deps.currentView === 'chat' && deps.hasActiveChat && dmSyncMessagesRef.current) {
      lastVisibilitySyncAtRef.current = now;
      debugLog('info', '[App] Visibility restored — triggering DM sync');
      dmSyncMessagesRef.current();
    } else if (deps.currentView === 'room-chat' && deps.hasActiveRoom && roomSyncMessagesRef.current) {
      lastVisibilitySyncAtRef.current = now;
      debugLog('info', '[App] Visibility restored — triggering room sync');
      roomSyncMessagesRef.current();
    }
  }, []);

  useAppLifecycle({
    isConnected,
    publish,
    onVisibilityRestored: handleVisibilityRestored,
  });

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

  const showWalletChrome =
    isReady &&
    !isAuthLoading &&
    isAuthenticated &&
    !initError &&
    !(wsError && !wsError.recoverable);

  const shouldMountWalletChromeUi =
    showWalletChrome && (environment === 'browser' || telegramWalletChromeRequested);

  const walletChrome = shouldMountWalletChromeUi ? (
    <WalletErrorBoundary>
      <Suspense fallback={null}>
        <LazyWalletChrome />
      </Suspense>
    </WalletErrorBoundary>
  ) : null;

  // Loading state
  if (!isReady || isAuthLoading) {
    return (
      <>
        {walletChrome}
        <LoadingOverlay message="Loading BurnedChats..." />
      </>
    );
  }

  if (environment === 'browser' && !isAuthenticated) {
    return (
      <>
        {walletChrome}
        <WalletLoginScreen />
      </>
    );
  }

  // Initialization error
  if (initError) {
    return (
      <>
        {walletChrome}
        <div className="error-screen">
          <div className="error-icon">&#9888;&#65039;</div>
          <h2>Cannot Start App</h2>
          <p>{initError}</p>
        </div>
      </>
    );
  }

  // Non-recoverable WebSocket error
  if (wsError && !wsError.recoverable) {
    return (
      <>
        {walletChrome}
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
      </>
    );
  }

  const debugPanelElement = prefs.debugPanelEnabled ? (
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
  ) : null;

  if (location.pathname.startsWith('/app/governance')) {
    return (
      <>
        {walletChrome}
        <Layout bottomNav={layoutBottomNav}>
          <Routes>
            <Route path="/app/governance" element={<GovernancePage />}>
              <Route index element={<ProposalList />} />
              <Route path="new" element={<CreateProposal />} />
              <Route path=":proposalId" element={<ProposalDetail />} />
            </Route>
          </Routes>
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  if (location.pathname === '/app/staking') {
    return (
      <>
        {walletChrome}
        <Layout bottomNav={layoutBottomNav}>
          <StakingPage />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  if (location.pathname.startsWith('/app/wallet')) {
    return (
      <>
        {walletChrome}
        <Layout bottomNav={layoutBottomNav}>
          <WalletPage />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  if (location.pathname.startsWith('/app/settings')) {
    return (
      <>
        {walletChrome}
        <Layout bottomNav={layoutBottomNav}>
          <SettingsPage
            user={user}
            linkedAccountsCredentials={linkedAccountsCredentials}
            onTonWalletChromeNeeded={requestTelegramWalletChrome}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Pending request view (waiting for recipient to accept)
  if (currentView === 'pending-request' && pendingSession) {
    return (
      <>
        {walletChrome}
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
        {walletChrome}
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
        {walletChrome}
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
  if (currentView === 'chat' && activeChat && myInternalId !== null) {
    return (
      <>
        {walletChrome}
        <Layout fullBleed>
          <ChatViewContent
            sessionId={activeChat.sessionId}
            peer={activeChat.peer}
            userId={myInternalId}
            userTelegramId={telegramUserId ?? undefined}
            ws={{ isConnected, isReconnection, subscribe, unsubscribe, publish }}
            onBack={handleLeaveChat}
            onBurn={handleBurnFromChat}
            syncMessagesRef={dmSyncMessagesRef}
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
        {walletChrome}
        <Layout>
          <CreateRoomView
            isLoading={isCreatingRoom}
            error={createRoomResult.error}
            onSubmit={handleCreateRoomSubmit}
            onCancel={() => {
              resetCreateRoom();
              setCurrentView('home');
            }}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Join room view (opened via Telegram invite deep link) — P2-2.2.4
  if (currentView === 'join-room' && inviteToken) {
    return (
      <>
        {walletChrome}
        <Layout>
          <JoinRoomView
            token={inviteToken}
            status={joinRoomResult.status}
            joinMode={joinRoomResult.joinMode}
            hasPassword={joinRoomResult.hasPassword}
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
        {walletChrome}
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
  if (currentView === 'room-chat' && activeRoomChat && myInternalId !== null) {
    const activeRoom = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    // Fall back to the cached isOwner flag when myRooms hasn't loaded yet
    // (e.g. immediately after room creation before fetchRooms completes).
    const isRoomOwner = activeRoom ? activeRoom.role === 'owner' : (activeRoomChat.isOwner ?? false);

    return (
      <>
        {walletChrome}
        <Layout fullBleed>
          <RoomChatRoom
            roomId={activeRoomChat.roomId}
            epoch={activeRoomChat.epoch}
            userId={myInternalId}
            userTelegramId={telegramUserId ?? undefined}
            ws={{ isConnected, isReconnection, subscribe, unsubscribe, publish }}
            isOwner={isRoomOwner}
            isRequestingKey={isRequestingKey}
            onRequestKey={retryKeyRequest}
            onBack={() => {
              setActiveRoomChat(null);
              setCurrentView('home');
            }}
            onManage={isRoomOwner ? handleOpenRoomManage : undefined}
            onLeave={!isRoomOwner ? handleLeaveRoom : undefined}
            syncMessagesRef={roomSyncMessagesRef}
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
        {walletChrome}
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
      {walletChrome}
      <Layout bottomNav={layoutBottomNav}>
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
          onRefreshRooms={fetchRooms}
          onRefreshAll={() => { fetchRooms(); fetchSessions(); }}
          onTonWalletChromeNeeded={requestTelegramWalletChrome}
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
  /** Current user's stable internal id */
  userId: string;
  /** Telegram numeric id when linked (legacy DM senderId wire events) */
  userTelegramId?: number;
  ws: UseMessagesWebSocket;
  onBack: () => void;
  onBurn: () => void;
  /**
   * Out-ref populated with the hook's `syncMessages` function so parents
   * (AppContent) can trigger an offline-queue sync from outside this component,
   * e.g. when the Mini App returns from background (FIX-SYNC-3).
   */
  syncMessagesRef?: MutableRefObject<(() => void) | null>;
}

function ChatViewContent({ sessionId, peer, userId, userTelegramId, ws, onBack, onBurn, syncMessagesRef }: ChatViewContentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const handleMessageError = useCallback((
    code: MessageErrorCode,
    details?: string,
    i18nValues?: Record<string, string | number>,
  ) => {
    console.error('[ChatViewContent] Message error:', code, details);
    if (isFilesErrorI18nKey(details)) {
      toast.error(t(details!, i18nValues), { duration: 5000 });
    }
  }, [t, toast]);

  const handleDmEditError = useCallback(
    (code: string) => {
      if (code === 'WINDOW_EXPIRED') {
        toast.error(t('chat.edit.windowExpired'));
      } else if (code === 'NOT_EDITABLE' || code === 'NOT_OWNER' || code === 'NOT_PARTICIPANT') {
        toast.error(t('chat.edit.notEditable'));
      } else {
        toast.error(t('chat.edit.failed'));
      }
    },
    [t, toast],
  );

  const { messages, sendMessage, sendFileMessage, isLoading, error, syncMessages, hideMessages, editMessage, deleteMessage } = useMessages({
    sessionId,
    userId,
    userTelegramId,
    ws,
    onError: handleMessageError,
    onEditError: handleDmEditError,
  });

  // Publish the hook's syncMessages up to AppContent via the ref so the
  // visibility-restore handler can invoke it (FIX-SYNC-3).
  useEffect(() => {
    if (!syncMessagesRef) return;
    syncMessagesRef.current = syncMessages;
    return () => {
      if (syncMessagesRef.current === syncMessages) {
        syncMessagesRef.current = null;
      }
    };
  }, [syncMessagesRef, syncMessages]);

  const handleSendMessage = useCallback(
    (text: string, options?: { replyToMessageId?: string }) => {
      void sendMessage(text, options);
    },
    [sendMessage],
  );

  const handleEditDm = useCallback(
    (messageId: string, newText: string, originalClientTimestamp: number) =>
      editMessage(messageId, newText, originalClientTimestamp),
    [editMessage],
  );

  const handleSendFile = useCallback(
    (file: File, caption?: string, options?: { replyToMessageId?: string }) => {
      void sendFileMessage(file, caption, options);
    },
    [sendFileMessage],
  );

  return (
    <ChatRoom
      userTelegramId={userTelegramId}
      sessionId={sessionId}
      peer={peer}
      messages={messages}
      isLoading={isLoading}
      isVerified={true}
      onSendMessage={handleSendMessage}
      onSendFile={handleSendFile}
      onBack={onBack}
      onBurn={onBurn}
      disabled={!!error}
      errorMessage={error ? t('chat.temporarilyUnavailable') : undefined}
      hideMessages={hideMessages}
      onEditMessage={handleEditDm}
      onDeleteForEveryone={deleteMessage}
    />
  );
}

/**
 * App wrapper with providers
 */
function App() {
  return (
    <PreferencesProvider>
      <ToastProvider position="bottom" maxToasts={3}>
        <AuthContextProvider>
          <AppContent />
        </AuthContextProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

export default App;

