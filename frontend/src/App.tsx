import { useEffect, useState, useCallback, useRef, useMemo, Suspense, type ReactNode } from 'react';
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
import { useHandshake, MAX_HANDSHAKE_MANUAL_RETRIES, HANDSHAKE_RETRY_BASE_COOLDOWN_MS } from './hooks/useHandshake';
import { useVerification } from './hooks/useVerification';
import {
  claimBothVerifiedToast,
  forgetBothVerifiedToast,
} from './utils/claimBothVerifiedToast';
import { useBackButton } from './hooks/useBackButton';
import { useActiveSessions, type ActiveSession } from './hooks/useActiveSessions';
import { useCreateRoom, type RoomJoinMode } from './hooks/useCreateRoom';
import { useJoinRoom } from './hooks/useJoinRoom';
import { useMyRooms } from './hooks/useMyRooms';
import { useRoomJoinRequests } from './hooks/useRoomJoinRequests';
import { useKeyBundle } from './hooks/useKeyBundle';
import { useRekeyRoom, type RekeyErrorReason } from './hooks/useRekeyRoom';
import { createRoomTopicMultiplexer, useSetRoomName } from './hooks/useSetRoomName';
import { useRequestKeyBundle } from './hooks/useRequestKeyBundle';
import { useGetInviteLink } from './hooks/useGetInviteLink';
import { useManageInvites } from './hooks/useManageInvites';
import { useRoomMembers } from './hooks/useRoomMembers';
import { useRoomPresence } from './hooks/useRoomPresence';
import { useRoomRoles } from './hooks/useRoomRoles';
import { useKickMember } from './hooks/useKickMember';
import { useManageBans } from './hooks/useManageBans';
import { useRoomModeration } from './hooks/useRoomModeration';
import { useRoomTtl } from './hooks/useRoomTtl';
import { useRoomMessageTtl } from './hooks/useRoomMessageTtl';
import { Layout } from './components/Layout/Layout';
import { BottomNavBar, type BottomNavItem } from './components/BottomNavBar';
import { HomeIcon, WalletIcon, SettingsGearIcon } from './icons';
import { ChatRequestDialog, type ChatRequestSecretPayload } from './components/ChatRequestDialog';
import { WalletLoginScreen } from './components/Auth/WalletLoginScreen';
import { BurnConfirmDialog } from './components/BurnConfirmDialog';
import { BurnAllDialog, type BurnAllDialogMode } from './components/BurnAllDialog/BurnAllDialog';
import { PendingRequestView } from './components/PendingRequestView';
import { IncomingRequestView } from './components/IncomingRequestView';
import { HandshakeView, getHandshakeErrorMessage } from './components/HandshakeView';
import { VerificationView } from './components/VerificationView';
import { ChatRoom } from './components/Chat';
import { RoomChatRoom } from './components/Chat/RoomChatRoom';
import { RoomKeyRecoveryModal } from './components/RoomKeyRecoveryModal';
import { CreateRoomView } from './components/CreateRoomView';
import { JoinRoomView } from './components/JoinRoomView';
import { JoinLanding } from './components/JoinLanding';
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
import { LazyWalletProvider } from './components/Wallet/LazyWalletProvider';
import { WalletErrorBoundary } from './components/Wallet/WalletErrorBoundary';
import type { LinkedAccountsCredentials } from './components/Settings/LinkedAccounts';
import { completeTelegramWalletLink } from './services/accountLinkingApi';
import {
  buildTelegramInviteDeepLink,
  clearPendingInviteToken,
  parseInviteFragment,
  readPendingInviteToken,
  stashPendingInviteToken,
} from './utils/inviteLink';
import { useMessages, type UseMessagesWebSocket, type MessageErrorCode } from './hooks/useMessages';
import { useAppLifecycle, type BackgroundKeysBurnedInfo } from './hooks/useAppLifecycle';
import { useBurnAll } from './hooks/useBurnAll';
import { useDeadmanSwitch } from './hooks/useDeadmanSwitch';
import { useExitBurnFlow } from './hooks/useExitBurnFlow';
import { usePanicGesture } from './hooks/usePanicGesture';
import { PanicUndoToast } from './components/PanicUndoToast/PanicUndoToast';
import {
  burn as burnKeys,
  burnAll,
  burnGroupKey,
  getFingerprint,
  getSharedSecret,
  hasGroupKey,
  isHandshakeComplete,
} from './crypto/keyStore';
import { PreferencesProvider, usePreferences } from './preferences';
import { clearDownloadCache } from './services/fileDownloadService';
import { cancelAll } from './services/transferQueue';
import { performBurnAllLocalCleanup } from './utils/burnAllCleanup';
import { completeUserExit } from './utils/completeUserExit';
import { shouldRefreshHomeData } from './utils/shouldRefreshHomeData';
import { disconnectTonConnect } from './ton/connector';
import './components/BurnAllDialog/BurnAllDialog.css';
import './components/PanicUndoToast/PanicUndoToast.css';
import { isFilesErrorI18nKey } from './services/fileTransferErrors';
import type { UserInfo, ChatRequest, RoomRole } from './types';
import type { UseRoomMessagesWebSocket } from './hooks/useRoomMessages';
import './App.css';

/** Application view states */
type AppView =
  | 'home'
  | 'pending-request'
  | 'incoming-request'
  | 'handshake'
  | 'verify'
  | 'chat'
  | 'create-room'
  | 'join-room'
  | 'room-join-requests'
  | 'room-chat'
  | 'room-manage';

function canModerateRoom(role: RoomRole): boolean {
  return role === 'owner' || role === 'admin';
}

function resolveActiveRoomRole(
  hookRole: RoomRole | null,
  room: { role: RoomRole } | undefined,
  cachedIsOwner: boolean | undefined,
): RoomRole {
  if (hookRole) return hookRole;
  if (room) return room.role;
  if (cachedIsOwner) return 'owner';
  return 'member';
}

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
  'verify',
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
  const { user, isLoading: isAuthLoading, isAuthenticated, login, logout, getCredentials } = useAuth();
  const { 
    isReady, 
    isInTelegram,
    expand, 
    setClosingConfirmation, 
    setHeaderColor,
    setBottomBarColor,
    notificationOccurred,
    startParam,
    close,
  } = useTelegram();

  useTelegramViewport();

  /** Incremented on each WS reconnect (via onReconnect) — drives auto-resume handshake */
  const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
  /** Incremented when DM rekey completes — triggers queued-message resend in active chat (IMP-OQR-02). */
  const [rekeyResendNonce, setRekeyResendNonce] = useState(0);
  /** Session awaiting rekey resend after handshake completes (set before forceRefresh / resume rekey). */
  const pendingRekeyResendRef = useRef<string | null>(null);
  /** Guards auto-resume: one startHandshake per reconnect nonce */
  const lastHandshakeAutoResumeNonceRef = useRef(0);
  /** Session for which auto-resume last ran — reset on view/session change */
  const handshakeAutoResumeSessionRef = useRef<string | null>(null);
  
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
      if (error.type === 'room_subscribe_denied') {
        return;
      }
      if (error.recoverable) {
        toast.warning('Connection lost. Reconnecting...', { duration: 3000 });
      } else {
        notificationOccurred('error');
        toast.error(error.message, { title: 'Connection Error' });
      }
    },
    onReconnect: () => {
      debugLog('info', 'WebSocket reconnected');
      setWsReconnectNonce((n) => n + 1);
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
    powPhase: sessionPowPhase,
    powProgressIterations: sessionPowProgressIterations,
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
      if (errorCode !== 'POW_INVALID' && errorCode !== 'POW_FAILED') {
        toast.error(`Failed to create session: ${errorCode}`, { title: 'Error' });
      }
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
    onOurRequestRejected: (sessionId) => {
      if (pendingSession?.id !== sessionId) return;
      console.log('[App] Our request was rejected by peer:', sessionId);
      notificationOccurred('error');
      toast.info(t('pendingRequest.errorRejected'));
      setPendingSession(null);
      setCurrentView('home');
      resetSession();
      clearSearch();
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
    isHandshaking,
    keyRefreshSessionId,
    clearKeyRefresh,
  } = useHandshake({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onHandshakeComplete: (sessionId, fingerprint) => {
      setHandshakeManualRetryCount(0);
      lastHandshakeRetryAtRef.current = 0;
      notificationOccurred('success');
      toast.success('Secure connection established!');
      console.log('[App] Handshake complete:', sessionId, fingerprint);
      if (pendingRekeyResendRef.current === sessionId) {
        pendingRekeyResendRef.current = null;
        setRekeyResendNonce((n) => n + 1);
      }
    },
    onError: (errorCode) => {
      notificationOccurred('error');
      console.log('[App] Handshake failed:', errorCode);
      toast.error(getHandshakeErrorMessage(t, errorCode), {
        title: t('handshake.errorTitle'),
      });
    },
  });

  /** Sessions that already showed bothVerified toast this runtime (false→true dedup) */
  const bothVerifiedToastShownRef = useRef<Set<string>>(new Set());

  const {
    getStatus: getVerificationStatus,
    confirmVerification,
    reportMismatch,
    isFullyVerified,
    clearStatus: clearVerificationStatusRaw,
  } = useVerification({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onBothVerified: (sessionId) => {
      if (!claimBothVerifiedToast(bothVerifiedToastShownRef.current, sessionId)) {
        return;
      }
      notificationOccurred('success');
      toast.success(t('verification.verifiedToast'));
    },
    onMismatch: (sessionId) => {
      notificationOccurred('error');
      toast.error(t('verification.subtitleMismatch'), {
        title: t('verification.titleMismatch'),
      });
      console.warn('[App] Fingerprint mismatch reported for session:', sessionId);
    },
    onError: (errorCode) => {
      if (errorCode === 'FINGERPRINT_MISMATCH') {
        return;
      }
      notificationOccurred('error');
      if (errorCode === 'CONNECTION_ERROR') {
        toast.error(t('verification.connectionLost'), { title: t('handshake.errorTitle') });
      } else {
        toast.error(`Verification failed: ${errorCode}`, { title: 'Error' });
      }
    },
  });

  const clearVerificationStatus = useCallback(
    (sessionId: string) => {
      forgetBothVerifiedToast(bothVerifiedToastShownRef.current, sessionId);
      clearVerificationStatusRaw(sessionId);
    },
    [clearVerificationStatusRaw],
  );

  /** Session burns deferred until WebSocket reconnects (offline cancel) */
  const pendingBurnsRef = useRef<Set<string>>(new Set());

  const burnSessionEverywhere = useCallback(
    (sessionId: string, options?: { clearVerification?: boolean }) => {
      cancelAll();
      burnKeys(sessionId);
      if (options?.clearVerification !== false) {
        clearVerificationStatus(sessionId);
      }
      if (isConnected) {
        publish('/app/session.burn', { sessionId });
      } else {
        pendingBurnsRef.current.add(sessionId);
      }
    },
    [isConnected, publish, clearVerificationStatus]
  );

  useEffect(() => {
    if (!isConnected || pendingBurnsRef.current.size === 0) return;
    for (const sessionId of pendingBurnsRef.current) {
      publish('/app/session.burn', { sessionId });
    }
    pendingBurnsRef.current.clear();
  }, [isConnected, publish]);

  // My rooms hook (P2-4.1.2) — room list drives name subscriptions and rekey metadata
  const {
    rooms: myRooms,
    isLoading: isLoadingRooms,
    fetchRooms,
    updateRoomName,
    updateRoomRole,
  } = useMyRooms({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  const myRoomsRef = useRef(myRooms);
  useEffect(() => {
    myRoomsRef.current = myRooms;
  }, [myRooms]);

  const myRoomIds = useMemo(() => myRooms.map(r => r.roomId), [myRooms]);

  const topicMultiplexer = useMemo(
    () => createRoomTopicMultiplexer(subscribe, unsubscribe),
    [subscribe, unsubscribe],
  );

  const activeRoomMessageHandlerRef = useRef<((message: import('@stomp/stompjs').IMessage) => void) | null>(null);

  const roomChatWs = useMemo((): UseRoomMessagesWebSocket => ({
    isConnected,
    isReconnection,
    subscribe: (destination, callback) => {
      if (destination.startsWith('/topic/room/')) {
        if (activeRoomMessageHandlerRef.current) {
          topicMultiplexer.unsubscribe(destination, activeRoomMessageHandlerRef.current);
        }
        activeRoomMessageHandlerRef.current = callback;
        topicMultiplexer.subscribe(destination, callback);
        return null;
      }
      return subscribe(destination, callback);
    },
    unsubscribe: (destination) => {
      if (destination.startsWith('/topic/room/')) {
        if (activeRoomMessageHandlerRef.current) {
          topicMultiplexer.unsubscribe(destination, activeRoomMessageHandlerRef.current);
          activeRoomMessageHandlerRef.current = null;
        }
        return;
      }
      unsubscribe(destination);
    },
    publish,
  }), [isConnected, isReconnection, topicMultiplexer, subscribe, unsubscribe, publish]);

  const { setRoomName } = useSetRoomName({
    isConnected,
    publish,
    topicMultiplexer,
    roomIds: myRoomIds,
    onNameUpdated: updateRoomName,
  });

  const [isRenamingRoom, setIsRenamingRoom] = useState(false);
  const [renameRoomError, setRenameRoomError] = useState<string | null>(null);

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
      fetchRooms();
      setActiveRoomChat({ roomId: room.id, epoch: 0, isOwner: true });
      setCurrentView('room-chat');
    },
    onRoomNameSet: updateRoomName,
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
  const { status: rekeyStatus, errorReason, rekeyMode, rekeyRoom, reset: resetRekey } = useRekeyRoom({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    myId: myInternalId,
    getRoomNameCipher: (roomId) => {
      const room = myRoomsRef.current.find(r => r.roomId === roomId);
      if (!room) return undefined;
      return { nameEncrypted: room.nameEncrypted, nameIv: room.nameIv };
    },
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
    onRekeyNameUpdated: updateRoomName,
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

  const {
    invites: roomInvites,
    isLoading: isInvitesLoading,
    error: invitesError,
    refresh: refreshInvites,
    revoke: revokeInvite,
  } = useManageInvites({
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
    removeMember,
    updateMemberRole,
    applyOwnershipTransfer,
  } = useRoomMembers({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  const {
    bans: roomBans,
    isLoading: isBansLoading,
    error: bansError,
    refresh: refreshBans,
    unban: unbanMember,
    ban: banMember,
  } = useManageBans({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  const lastRemovalOpRef = useRef<'kick' | 'ban'>('kick');

  const handleKickSuccess = useCallback((roomId: string, targetInternalId: string) => {
    toast.success(
      lastRemovalOpRef.current === 'ban'
        ? t('room.manage.banSuccess')
        : t('room.manage.kickSuccess'),
    );
    removeMember(targetInternalId);
    fetchMembers(roomId);
    refreshBans(roomId);
  }, [toast, t, removeMember, fetchMembers, refreshBans]);

  const handleKickError = useCallback((errorCode: string) => {
    const key = `room.manage.kickError.${errorCode}`;
    const message = t(key);
    toast.error(message !== key ? message : t('room.manage.kickError.unknown'));
  }, [toast, t]);

  const { kick: kickMember } = useKickMember({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onKickSuccess: handleKickSuccess,
    onKickError: handleKickError,
  });

  // Track which requests are being processed (for loading state)
  const [processingJoinKeys, setProcessingJoinKeys] = useState<Set<string>>(new Set());

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
        if (isHandshakeComplete(session.sessionId)) {
          const fingerprint = getFingerprint(session.sessionId);
          if (fingerprint) {
            setActiveChat({ sessionId: session.sessionId, peer: peerInfo, fingerprint });
            toast.success(`Resumed chat with ${session.peer.displayName}`);
            setCurrentView(isFullyVerified(session.sessionId) ? 'chat' : 'verify');
          } else {
            toast.info('Restoring secure connection...');
            pendingRekeyResendRef.current = session.sessionId;
            startHandshake(session.sessionId, peerInfo);
            setCurrentView('handshake');
          }
        } else {
          toast.info('Restoring secure connection...');
          pendingRekeyResendRef.current = session.sessionId;
          startHandshake(session.sessionId, peerInfo);
          setCurrentView('handshake');
        }
      } else if (session.status === 'HANDSHAKE') {
        // Need to complete handshake
        toast.info('Resuming secure connection...');
        startHandshake(session.sessionId, peerInfo);
        setCurrentView('handshake');
      }
    },
    onError: (errorCode) => {
      if (!isAuthenticated) {
        return;
      }
      notificationOccurred('error');
      toast.error(`Failed to resume session: ${errorCode}`, { title: 'Error' });
    },
  });

  // Invite token state (P2-2.1.3)
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Tracks which invite token was already routed to join-room, preventing
  // the deep-link effect from re-firing (and resetting state) on WS reconnect.
  const inviteSetupTokenRef = useRef<string | null>(null);

  // Web invite route (/join#invite_{token}) — IMP-WEBINVITE-02
  const isJoinRoute = location.pathname === '/join';
  const [joinRouteToken, setJoinRouteToken] = useState<string | null>(null);
  const [joinRouteInvalid, setJoinRouteInvalid] = useState(false);
  const [joinLoginBusy, setJoinLoginBusy] = useState(false);

  // Active room ID for the requests view (P2-2.2.5)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // Track which view to return to from room-join-requests (P2-4.3.1)
  const [requestsReturnView, setRequestsReturnView] = useState<'home' | 'room-manage'>('home');

  // Active room chat state (P2-3.2.3)
  const [activeRoomChat, setActiveRoomChat] = useState<ActiveRoomChat | null>(null);
  /** Owner bootstrap rekey confirm modal (IMP-RKR-02). */
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);

  // Refresh member list for room chat header + manage view (IMP-ROOM-02)
  useEffect(() => {
    if (isConnected && activeRoomChat) {
      fetchMembers(activeRoomChat.roomId);
    }
  }, [isConnected, activeRoomChat?.roomId, fetchMembers]);

  // Track which session is being resumed
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);

  // Burn session state (4.6.11)
  const [showBurnDialog, setShowBurnDialog] = useState(false);
  const [burnTargetSession, setBurnTargetSession] = useState<{ sessionId: string; peerName: string } | null>(null);
  const [burningSessionId, setBurningSessionId] = useState<string | null>(null);
  const [burnAllDialogMode, setBurnAllDialogMode] = useState<BurnAllDialogMode | null>(null);
  const [showBurnAllComplete, setShowBurnAllComplete] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const exitBurnPendingRef = useRef(false);
  const panicBrandRef = useRef<HTMLDivElement | null>(null);
  const [panicToastOpen, setPanicToastOpen] = useState(false);

  // App state
  const [initError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [showChatRequestDialog, setShowChatRequestDialog] = useState(false);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);
  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);

  // Reference to store peer info for handshake
  const handshakePeerRef = useRef<UserInfo | null>(null);
  /** Manual in-place retry counter (state for UI; reset on complete, cancel, or start over) */
  const [handshakeManualRetryCount, setHandshakeManualRetryCount] = useState(0);
  const lastHandshakeRetryAtRef = useRef(0);
  
  // Active chat state
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  const ownsModerationTopic = currentView === 'room-manage' && activeRoomChat != null;

  const activeRoomIdForRoles = (
    currentView === 'room-chat' || currentView === 'room-manage'
  ) ? activeRoomChat?.roomId ?? null : null;

  const { myRole: activeRoomMyRole, setRole: setMemberRole, transferOwnership } = useRoomRoles({
    isConnected,
    roomId: activeRoomIdForRoles,
    myInternalId,
    myRooms,
    topicMultiplexer,
    publish,
    updateRoomRole,
    onMemberRoleUpdated: updateMemberRole,
    onOwnershipTransferred: applyOwnershipTransfer,
  });

  const handleSetMemberRole = useCallback((targetInternalId: string, role: 'admin' | 'member') => {
    updateMemberRole(targetInternalId, role);
    setMemberRole(targetInternalId, role);
  }, [updateMemberRole, setMemberRole]);

  const manageRoleForGuard = useMemo(() => {
    if (currentView !== 'room-manage' || !activeRoomChat) return null;
    const activeRoom = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    return resolveActiveRoomRole(activeRoomMyRole, activeRoom, activeRoomChat.isOwner);
  }, [currentView, activeRoomChat, myRooms, activeRoomMyRole]);

  useEffect(() => {
    if (manageRoleForGuard != null && !canModerateRoom(manageRoleForGuard)) {
      setCurrentView('room-chat');
    }
  }, [manageRoleForGuard]);

  const {
    readOnly: roomReadOnly,
    mutedIds: roomMutedIds,
    mute: muteMember,
    unmute: unmuteMember,
    setReadOnly: setRoomReadOnlyMode,
    handleModerationEvent: handleRoomModerationEvent,
    isMuted: isRoomMemberMuted,
  } = useRoomModeration({
    isConnected,
    roomId: activeRoomChat?.roomId ?? null,
    ownsTopicSubscription: ownsModerationTopic,
    topicMultiplexer,
    publish,
  });

  const {
    autoBurnAt: roomAutoBurnAt,
    applyPreset: applyRoomTtlPreset,
    applyCustomSeconds: applyCustomRoomTtlSeconds,
  } = useRoomTtl({
    isConnected,
    roomId: activeRoomIdForRoles,
    topicMultiplexer,
    publish,
  });

  const {
    messageTtlSeconds: roomMessageTtlSeconds,
    applyPreset: applyRoomMessageTtlPreset,
    applyCustomSeconds: applyCustomRoomMessageTtlSeconds,
  } = useRoomMessageTtl({
    isConnected,
    roomId: activeRoomIdForRoles,
    topicMultiplexer,
    publish,
  });

  const manageRoomIdForPresence = currentView === 'room-manage'
    ? activeRoomChat?.roomId ?? null
    : null;

  const {
    presence: roomMemberPresence,
    onlineCount: roomOnlineMemberCount,
  } = useRoomPresence({
    isConnected,
    roomId: manageRoomIdForPresence,
    topicMultiplexer,
    subscribe,
    unsubscribe,
    publish,
  });

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
      if (sessionId) {
        console.log('[App] Burning session after handshake cancel (back button):', sessionId);
        burnSessionEverywhere(sessionId);
      }
      return;
    }

    if (currentView === 'verify') {
      const sessionId = activeChat?.sessionId ?? handshakeResult.sessionId;
      setActiveChat(null);
      handshakePeerRef.current = null;
      resetHandshake();
      setCurrentView('home');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      if (sessionId) {
        console.log('[App] Burning session after verification cancel (back button):', sessionId);
        burnSessionEverywhere(sessionId);
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
    activeChat?.sessionId,
    resetHandshake,
    fetchSessions,
    resetInviteLink,
    requestsReturnView,
    burnSessionEverywhere,
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

  // Owner flow: do NOT auto-rekey on re-entry — silent rekey invalidates history for all members.
  // Owner without a local key must recover manually via confirm modal (IMP-RKR-02).
  const ownerKeyLostNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeRoomNeedsKey || !activeRoomIsOwner || !isConnected || !activeRoomChat) {
      ownerKeyLostNotifiedRef.current = null;
      return;
    }
    const roomId = activeRoomChat.roomId;
    if (ownerKeyLostNotifiedRef.current === roomId) return;
    ownerKeyLostNotifiedRef.current = roomId;
    debugLog(
      'warn',
      `[App] Owner entered room ${roomId} without local group key — auto-rekey disabled; use recovery modal`,
    );
    toast.warning(t('room.recovery.neededToast'), { duration: 6000 });
  }, [activeRoomNeedsKey, activeRoomIsOwner, isConnected, activeRoomChat, toast, t]);

  const handleOwnerRecoverKeys = useCallback(() => {
    setRecoveryModalOpen(true);
  }, []);

  const handleRecoveryModalClose = useCallback(() => {
    setRecoveryModalOpen(false);
  }, []);

  const handleRecoveryConfirm = useCallback(() => {
    if (!activeRoomChat) return;
    rekeyRoom(activeRoomChat.roomId, { bootstrap: true });
  }, [activeRoomChat, rekeyRoom]);

  const isBootstrapRekeyInFlight =
    rekeyMode === 'bootstrap' &&
    (rekeyStatus === 'fetching-keys' || rekeyStatus === 'rekeying');

  const rekeyErrorNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (rekeyStatus !== 'error' || rekeyMode !== 'bootstrap') {
      if (rekeyStatus !== 'error') {
        rekeyErrorNotifiedRef.current = null;
      }
      return;
    }
    const roomId = activeRoomChat?.roomId ?? 'unknown';
    const notifyKey = `${roomId}:${errorReason ?? 'unknown'}`;
    if (rekeyErrorNotifiedRef.current === notifyKey) return;
    rekeyErrorNotifiedRef.current = notifyKey;

    const reasonKey: Record<NonNullable<RekeyErrorReason>, string> = {
      'no-local-key': 'room.recovery.errorNoLocalKey',
      'pubkeys-failed': 'room.recovery.errorPubkeysFailed',
      'parse-failed': 'room.recovery.errorParseFailed',
      'rekey-failed': 'room.recovery.errorRekeyFailed',
    };
    const message = errorReason
      ? t(reasonKey[errorReason])
      : t('room.recovery.errorGeneric');
    toast.error(message, { duration: 8000 });
  }, [rekeyStatus, rekeyMode, errorReason, activeRoomChat?.roomId, toast, t]);

  useEffect(() => {
    if (rekeyStatus === 'done' && rekeyMode === 'bootstrap') {
      setRecoveryModalOpen(false);
      resetRekey();
    }
  }, [rekeyStatus, rekeyMode, resetRekey]);

  useEffect(() => {
    if (!activeRoomNeedsKey || !activeRoomIsOwner) {
      setRecoveryModalOpen(false);
    }
  }, [activeRoomNeedsKey, activeRoomIsOwner]);

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

  const handleRefreshInvites = useCallback(() => {
    if (activeRoomChat) {
      refreshInvites(activeRoomChat.roomId);
    }
  }, [activeRoomChat, refreshInvites]);

  const handleCreateInviteLink = useCallback((options: { expiresInSeconds?: number; maxUses?: number }) => {
    if (!activeRoomChat) return;
    getInviteLink(activeRoomChat.roomId, options);
  }, [activeRoomChat, getInviteLink]);

  const handleRevokeInvite = useCallback((token: string) => {
    if (!activeRoomChat) return;
    revokeInvite(activeRoomChat.roomId, token);
  }, [activeRoomChat, revokeInvite]);

  useEffect(() => {
    if (inviteUrl && activeRoomChat && currentView === 'room-manage') {
      refreshInvites(activeRoomChat.roomId);
    }
  }, [inviteUrl, activeRoomChat, currentView, refreshInvites]);

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
    if (activeRoomChat?.roomId === roomId) {
      fetchMembers(roomId);
    }
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
  }, [
    acceptJoinRequest,
    removeJoinRequest,
    notificationOccurred,
    toast,
    activeRoomChat?.roomId,
    fetchMembers,
  ]);

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
  const handleCreateRoomSubmit = useCallback((password: string | null, joinMode: RoomJoinMode, roomName?: string) => {
    createRoom(password, joinMode, roomName);
  }, [createRoom]);

  const handleRenameRoom = useCallback(async (name: string) => {
    if (!activeRoomChat) return;
    setIsRenamingRoom(true);
    setRenameRoomError(null);
    try {
      await setRoomName(activeRoomChat.roomId, name);
      toast.success(t('room.manage.renameSuccess'));
    } catch {
      setRenameRoomError(t('room.manage.renameError'));
    } finally {
      setIsRenamingRoom(false);
    }
  }, [activeRoomChat, setRoomName, toast, t]);

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

  // Web invite route: parse fragment and stash token before wallet-login redirects
  useEffect(() => {
    if (!isJoinRoute) return;

    let token = parseInviteFragment(window.location.hash);
    if (!token && environment === 'browser') {
      token = readPendingInviteToken();
    }

    if (!token) {
      setJoinRouteInvalid(true);
      setJoinRouteToken(null);
      return;
    }

    setJoinRouteInvalid(false);
    setJoinRouteToken(token);
    if (environment === 'browser' && !isAuthenticated) {
      stashPendingInviteToken(token);
    }
  }, [isJoinRoute, environment, isAuthenticated]);

  // Web invite route: enter join flow when auth is ready (browser or Telegram MiniApp)
  useEffect(() => {
    if (!isJoinRoute || !isReady || joinRouteInvalid) return;

    let token = joinRouteToken;
    if (!token && environment === 'browser') {
      token = readPendingInviteToken();
    }
    if (!token) return;

    if (environment === 'browser' && !isAuthenticated) return;

    if (inviteSetupTokenRef.current !== token) {
      inviteSetupTokenRef.current = token;
      resetJoinRoom();
      setInviteToken(token);
      setCurrentView('join-room');
      clearPendingInviteToken();
    }

    if (isConnected) {
      loadInviteInfo(token);
    }
  }, [
    isJoinRoute,
    isReady,
    joinRouteInvalid,
    joinRouteToken,
    environment,
    isAuthenticated,
    isConnected,
    resetJoinRoom,
    loadInviteInfo,
  ]);

  const handleJoinBrowserLogin = useCallback(async () => {
    setJoinLoginBusy(true);
    try {
      await login();
    } catch {
      toast.error(t('walletLogin.errorGeneric'), { title: t('walletLogin.title') });
    } finally {
      setJoinLoginBusy(false);
    }
  }, [login, toast, t]);

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
    if (sessionId) {
      console.log('[App] Burning session after pending request cancel:', sessionId);
      burnSessionEverywhere(sessionId, { clearVerification: false });
    }
  }, [resetSession, clearSearch, pendingSession, burnSessionEverywhere]);

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
    setHandshakeManualRetryCount(0);
    lastHandshakeRetryAtRef.current = 0;
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
    if (sessionId) {
      console.log('[App] Burning session after handshake cancel:', sessionId);
      burnSessionEverywhere(sessionId);
    }
  }, [cancelHandshake, resetSession, clearSearch, handshakeResult.sessionId, burnSessionEverywhere]);

  const burnVerificationSession = useCallback((sessionId: string) => {
    burnSessionEverywhere(sessionId);
    clearDownloadCache();
  }, [burnSessionEverywhere]);

  // Handle continuing after handshake complete
  const handleHandshakeComplete = useCallback(() => {
    const sessionId = handshakeResult.sessionId;
    const peer = handshakePeerRef.current;
    const fingerprint = handshakeResult.fingerprint;
    
    if (sessionId && peer && fingerprint) {
      setActiveChat({ sessionId, peer, fingerprint });
      setCurrentView('verify');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      console.log('[App] Entering verification:', sessionId);
    } else {
      // Fallback to home if something is missing
      console.warn('[App] Missing data for verification, going to home');
      handshakePeerRef.current = null;
      resetHandshake();
      setCurrentView('home');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      fetchSessions();
    }
  }, [handshakeResult.sessionId, handshakeResult.fingerprint, resetHandshake, clearSearch, fetchSessions]);

  const handleVerificationContinue = useCallback(() => {
    const sessionId = activeChat?.sessionId;
    if (!sessionId) return;

    const status = getVerificationStatus(sessionId);
    if (status?.bothVerified) {
      setCurrentView('chat');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      console.log('[App] Entering chat after verification:', sessionId);
      return;
    }

    if (status?.selfVerified) {
      setCurrentView('chat');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      console.log('[App] Skipping peer verification wait, entering chat:', sessionId);
      return;
    }

    if (status?.mismatchReported) {
      burnVerificationSession(sessionId);
      setActiveChat(null);
      handshakePeerRef.current = null;
      resetHandshake();
      setCurrentView('home');
      setPendingSession(null);
      setActiveIncomingRequest(null);
      clearSearch();
      fetchSessions();
    }
  }, [
    activeChat?.sessionId,
    getVerificationStatus,
    burnVerificationSession,
    resetHandshake,
    clearSearch,
    fetchSessions,
  ]);

  const handleVerificationCancel = useCallback(() => {
    const sessionId = activeChat?.sessionId ?? handshakeResult.sessionId;
    setActiveChat(null);
    handshakePeerRef.current = null;
    resetHandshake();
    setCurrentView('home');
    setPendingSession(null);
    setActiveIncomingRequest(null);
    clearSearch();
    if (sessionId) {
      console.log('[App] Burning session after verification cancel:', sessionId);
      burnSessionEverywhere(sessionId);
    }
  }, [
    activeChat?.sessionId,
    handshakeResult.sessionId,
    resetHandshake,
    clearSearch,
    burnSessionEverywhere,
  ]);

  const handleVerificationMismatch = useCallback(() => {
    const sessionId = activeChat?.sessionId ?? handshakeResult.sessionId;
    if (!sessionId) return;

    reportMismatch(sessionId);
    burnVerificationSession(sessionId);
    setActiveChat(null);
    handshakePeerRef.current = null;
    resetHandshake();
    setCurrentView('home');
    setPendingSession(null);
    setActiveIncomingRequest(null);
    clearSearch();
    fetchSessions();
    notificationOccurred('warning');
    toast.warning(t('verification.mismatchWarning'), {
      title: t('verification.titleMismatch'),
    });
  }, [
    activeChat?.sessionId,
    handshakeResult.sessionId,
    reportMismatch,
    burnVerificationSession,
    resetHandshake,
    clearSearch,
    fetchSessions,
    notificationOccurred,
    toast,
    t,
  ]);

  // Handle in-place retry after handshake error/timeout (no page reload)
  const handleRetryHandshake = useCallback(() => {
    const sessionId = handshakeResult.sessionId;
    const peer = handshakePeerRef.current;
    if (!sessionId || !peer) {
      return;
    }

    if (handshakeManualRetryCount >= MAX_HANDSHAKE_MANUAL_RETRIES) {
      toast.error(t('handshake.errors.RETRY_LIMIT'), { title: t('handshake.errorTitle') });
      return;
    }

    const cooldownMs = HANDSHAKE_RETRY_BASE_COOLDOWN_MS
      * Math.pow(2, Math.min(handshakeManualRetryCount, 4));
    const elapsed = Date.now() - lastHandshakeRetryAtRef.current;
    if (lastHandshakeRetryAtRef.current > 0 && elapsed < cooldownMs) {
      return;
    }

    const nextAttempt = handshakeManualRetryCount + 1;
    setHandshakeManualRetryCount(nextAttempt);
    lastHandshakeRetryAtRef.current = Date.now();

    console.log('[App] In-place handshake retry:', sessionId, 'attempt', nextAttempt);
    resetHandshake();
    startHandshake(sessionId, peer, true);
  }, [handshakeResult.sessionId, handshakeManualRetryCount, startHandshake, resetHandshake, toast, t]);

  // Handle start over from handshake error — burn session and return home without reload
  const handleStartOverHandshake = useCallback(() => {
    handleCancelHandshake();
  }, [handleCancelHandshake]);

  const handshakeRetryDisabled = handshakeManualRetryCount >= MAX_HANDSHAKE_MANUAL_RETRIES;

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
    const skipInitialHomeRender = isFirstHomeRender.current;
    if (skipInitialHomeRender) {
      isFirstHomeRender.current = false;
    }

    if (
      !shouldRefreshHomeData({
        currentView,
        isAuthenticated,
        isConnected,
        skipInitialHomeRender,
      })
    ) {
      return;
    }

    fetchRooms();
    fetchSessions();
  }, [currentView, isAuthenticated, isConnected, fetchRooms, fetchSessions]);

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

          // If we're in verification view for this session, go back to home
          if (deps.currentView === 'verify' && deps.activeChat?.sessionId === data.sessionId) {
            setActiveChat(null);
            handshakePeerRef.current = null;
            deps.resetHandshake();
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

  // Owner removes a member from manage view (IMP-ROOM-04, IMP-ROOM-24)
  const handleKickMember = useCallback((targetInternalId: string) => {
    if (!activeRoomChat || !isConnected) return;
    lastRemovalOpRef.current = 'kick';
    kickMember(activeRoomChat.roomId, targetInternalId);
    debugLog('info', `[RoomManage] KICK_MEMBER sent for ${targetInternalId} in ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, kickMember]);

  const handleBanMember = useCallback((targetInternalId: string) => {
    if (!activeRoomChat || !isConnected) return;
    lastRemovalOpRef.current = 'ban';
    banMember(activeRoomChat.roomId, targetInternalId);
    debugLog('info', `[RoomManage] BAN_MEMBER sent for ${targetInternalId} in ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, banMember]);

  const handleRefreshBans = useCallback(() => {
    if (!activeRoomChat || !isConnected) return;
    refreshBans(activeRoomChat.roomId);
  }, [activeRoomChat, isConnected, refreshBans]);

  const handleUnbanMember = useCallback((targetInternalId: string) => {
    if (!activeRoomChat || !isConnected) return;
    unbanMember(activeRoomChat.roomId, targetInternalId);
    debugLog('info', `[RoomManage] UNBAN_MEMBER sent for ${targetInternalId} in ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, unbanMember]);

  const handleMuteMember = useCallback((targetInternalId: string) => {
    if (!activeRoomChat || !isConnected) return;
    muteMember(activeRoomChat.roomId, targetInternalId);
    debugLog('info', `[RoomManage] MUTE_MEMBER sent for ${targetInternalId} in ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, muteMember]);

  const handleUnmuteMember = useCallback((targetInternalId: string) => {
    if (!activeRoomChat || !isConnected) return;
    unmuteMember(activeRoomChat.roomId, targetInternalId);
    debugLog('info', `[RoomManage] UNMUTE_MEMBER sent for ${targetInternalId} in ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, unmuteMember]);

  const handleSetRoomReadOnly = useCallback((readOnly: boolean) => {
    if (!activeRoomChat || !isConnected) return;
    setRoomReadOnlyMode(activeRoomChat.roomId, readOnly);
    debugLog('info', `[RoomManage] SET_READ_ONLY=${readOnly} for ${activeRoomChat.roomId}`);
  }, [activeRoomChat, isConnected, setRoomReadOnlyMode]);

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

  // Refs for ROOM_LEFT / ROOM_MEMBER_LEFT / kick handler dependencies
  const roomLeftDepsRef = useRef({
    currentView,
    activeRoomChat,
    myRooms,
    notificationOccurred,
    toast,
    fetchRooms,
    fetchMembers,
    removeMember,
  });
  useEffect(() => {
    roomLeftDepsRef.current = {
      currentView,
      activeRoomChat,
      myRooms,
      notificationOccurred,
      toast,
      fetchRooms,
      fetchMembers,
      removeMember,
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

        const isViewingRoom =
          (deps.currentView === 'room-chat' || deps.currentView === 'room-manage')
          && deps.activeRoomChat?.roomId === roomId;

        if (isViewingRoom) {
          if (leftMemberId) {
            deps.removeMember(leftMemberId);
          }
          deps.fetchMembers(roomId);
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

  // Subscribe to ROOM_MEMBER_REMOVED — owner must rekey after kick (IMP-ROOM-03/04)
  useEffect(() => {
    if (!isConnected) return;

    const handleRoomMemberRemoved = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body) as {
          roomId?: string;
          removedInternalId?: string;
        };
        const deps = roomLeftDepsRef.current;

        if (!data.roomId) return;

        const roomId = data.roomId;
        const isOwner = deps.myRooms.find(r => r.roomId === roomId)?.role === 'owner';

        debugLog(
          'info',
          `[RoomChat] ROOM_MEMBER_REMOVED: room=${roomId}, removedInternalId=${data.removedInternalId}, isOwner=${isOwner}`,
        );

        if (isOwner) {
          rekeyRoomRef.current(roomId);
        }

        const isViewingRoom =
          (deps.currentView === 'room-chat' || deps.currentView === 'room-manage')
          && deps.activeRoomChat?.roomId === roomId;

        if (isViewingRoom) {
          if (data.removedInternalId) {
            deps.removeMember(data.removedInternalId);
          }
          deps.fetchMembers(roomId);
        }
      } catch (err) {
        console.error('[App] Failed to parse ROOM_MEMBER_REMOVED event:', err);
      }
    };

    subscribe('/user/queue/room-member-removed', handleRoomMemberRemoved);

    return () => {
      unsubscribe('/user/queue/room-member-removed');
    };
  }, [isConnected, subscribe, unsubscribe]);

  // Subscribe to ROOM_KICKED — victim is forcibly removed (IMP-ROOM-04)
  useEffect(() => {
    if (!isConnected) return;

    const handleRoomKicked = (message: { body: string }) => {
      try {
        const data = JSON.parse(message.body) as {
          roomId?: string;
          byInternalId?: string;
        };
        const deps = roomLeftDepsRef.current;

        if (!data.roomId) return;

        const roomId = data.roomId;

        debugLog(
          'info',
          `[RoomChat] ROOM_KICKED: room=${roomId}, byInternalId=${data.byInternalId}`,
        );

        cancelAll();
        burnGroupKey(roomId);

        const isViewingRoom =
          (deps.currentView === 'room-chat' || deps.currentView === 'room-manage') &&
          deps.activeRoomChat?.roomId === roomId;

        if (isViewingRoom) {
          setActiveRoomChat(null);
          setCurrentView('home');
        }

        deps.fetchRooms();
        deps.notificationOccurred('warning');
        deps.toast.warning(t('room.kicked.message'), { title: t('room.kicked.title') });
      } catch (err) {
        console.error('[App] Failed to parse ROOM_KICKED event:', err);
      }
    };

    subscribe('/user/queue/room-kicked', handleRoomKicked);

    return () => {
      unsubscribe('/user/queue/room-kicked');
    };
  }, [isConnected, subscribe, unsubscribe, t]);

  // Kicked while offline: after ROOM_LIST refresh, active room may no longer be listed (IMP-ROOM-04)
  useEffect(() => {
    if (isLoadingRooms || !activeRoomChat) return;
    if (currentView !== 'room-chat' && currentView !== 'room-manage') return;

    const roomId = activeRoomChat.roomId;
    const isMember = myRooms.some(r => r.roomId === roomId);

    if (!isMember && myRooms.length === 0 && activeRoomChat.isOwner) {
      return;
    }

    if (!isMember) {
      cancelAll();
      burnGroupKey(roomId);
      setActiveRoomChat(null);
      setCurrentView('home');
      notificationOccurred('warning');
      toast.warning(t('room.kicked.offlineMessage'), { title: t('room.kicked.title') });
      debugLog('info', `[RoomChat] Evicted from room ${roomId} (not in myRooms after refresh)`);
    }
  }, [myRooms, isLoadingRooms, activeRoomChat, currentView, notificationOccurred, toast, t]);

  // STOMP ERROR NOT_MEMBER on room topic subscribe — reconnect / race before ROOM_KICKED (IMP-ROOM-26)
  const lastRoomSubscribeDeniedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wsError || wsError.type !== 'room_subscribe_denied') return;

    const errorKey = `${wsError.type}:${wsError.roomId ?? 'unknown'}:${wsError.message}`;
    if (lastRoomSubscribeDeniedRef.current === errorKey) return;
    lastRoomSubscribeDeniedRef.current = errorKey;

    const deps = roomLeftDepsRef.current;
    const roomId =
      wsError.roomId ??
      ((deps.currentView === 'room-chat' || deps.currentView === 'room-manage')
        ? deps.activeRoomChat?.roomId
        : undefined);

    if (!roomId) {
      debugLog('warn', '[RoomChat] NOT_MEMBER subscribe without roomId — skipped evict');
      return;
    }

    cancelAll();
    burnGroupKey(roomId);

    const isViewingRoom =
      (deps.currentView === 'room-chat' || deps.currentView === 'room-manage') &&
      deps.activeRoomChat?.roomId === roomId;

    if (isViewingRoom) {
      setActiveRoomChat(null);
      setCurrentView('home');
    }

    deps.fetchRooms();
    deps.notificationOccurred('warning');
    deps.toast.warning(t('room.subscribeDenied'), { title: t('room.kicked.title') });
    debugLog('info', `[RoomChat] Evicted from room ${roomId} (NOT_MEMBER on subscribe)`);
  }, [wsError, t]);

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
  const membersVisibilityTimerRef = useRef<number | null>(null);
  const MEMBERS_VISIBILITY_DEBOUNCE_MS = 400;
  const backgroundBurnPendingToastRef = useRef(false);

  // Keep the latest view/chat state in a ref so the visibility callback can
  // read fresh values without being re-created on every state change.
  const visibilitySyncDepsRef = useRef({
    currentView,
    hasActiveChat: activeChat != null,
    hasActiveRoom: activeRoomChat != null,
    activeRoomId: activeRoomChat?.roomId ?? null,
    isConnected,
    fetchMembers,
  });
  useEffect(() => {
    visibilitySyncDepsRef.current = {
      currentView,
      hasActiveChat: activeChat != null,
      hasActiveRoom: activeRoomChat != null,
      activeRoomId: activeRoomChat?.roomId ?? null,
      isConnected,
      fetchMembers,
    };
  });

  const handleBackgroundKeysBurned = useCallback((info: BackgroundKeysBurnedInfo) => {
    backgroundBurnPendingToastRef.current = true;

    for (const sessionId of info.sessionIdsBurned) {
      clearVerificationStatus(sessionId);
    }

    setActiveChat(null);
    setActiveRoomChat(null);
    setPendingSession(null);
    setActiveIncomingRequest(null);
    handshakePeerRef.current = null;
    cancelHandshake();
    resetHandshake();
    resetSession();
    clearSearch();
    setCurrentView('home');
  }, [
    clearVerificationStatus,
    cancelHandshake,
    resetHandshake,
    resetSession,
    clearSearch,
  ]);

  const resetAppStateAfterBurnAll = useCallback(() => {
    setActiveChat(null);
    setActiveRoomChat(null);
    setPendingSession(null);
    setActiveIncomingRequest(null);
    setShowChatRequestDialog(false);
    setSelectedUser(null);
    setShowBurnDialog(false);
    setBurnTargetSession(null);
    setBurningSessionId(null);
    setInviteToken(null);
    handshakePeerRef.current = null;
    cancelHandshake();
    resetHandshake();
    resetSession();
    resetIncomingAction();
    resetCreateRoom();
    resetJoinRoom();
    clearSearch();
    setCurrentView('home');
    navigate('/app');
  }, [
    cancelHandshake,
    resetHandshake,
    resetSession,
    resetIncomingAction,
    resetCreateRoom,
    resetJoinRoom,
    clearSearch,
    navigate,
  ]);

  const { burnAllState, error: burnAllError, requestBurnAll, resetBurnAll } = useBurnAll({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
    onComplete: (event) => {
      void (async () => {
        await performBurnAllLocalCleanup({
          wipeIdentity: event.wipeIdentity,
          disconnectTon: disconnectTonConnect,
        });

        if (exitBurnPendingRef.current) {
          exitBurnPendingRef.current = false;
          setExitDialogOpen(false);
          resetBurnAll();
          completeUserExit({ isInTelegram, closeMiniApp: close, logout });
          return;
        }

        resetAppStateAfterBurnAll();
        fetchSessions();
        fetchRooms();
        setBurnAllDialogMode(null);
        setShowBurnAllComplete(true);
        notificationOccurred('success');
        toast.success(t('settings.burnAll.completeTitle'));

        if (event.wipeIdentity) {
          disconnect(true);
          logout();
        }
      })();
    },
    onError: (code) => {
      if (code === 'NOT_CONNECTED') {
        toast.error(t('settings.burnAll.offlineError'));
      }
    },
  });

  const { deadman, setDeadman } = useDeadmanSwitch({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  const {
    isBurning: exitIsBurning,
    error: exitBurnError,
    startBurnAndExit,
    retryBurnAndExit,
    resetExitBurn,
  } = useExitBurnFlow({
    burnAllState,
    burnAllError,
    requestBurnAll,
    resetBurnAll,
    exitBurnPendingRef,
  });

  const handleJustExit = useCallback(() => {
    cancelAll();
    burnAll('manual');
    setExitDialogOpen(false);
    resetExitBurn();
    completeUserExit({ isInTelegram, closeMiniApp: close, logout });
  }, [close, isInTelegram, logout, resetExitBurn]);

  const handleCloseExitDialog = useCallback(() => {
    if (exitIsBurning) {
      return;
    }
    setExitDialogOpen(false);
    resetExitBurn();
  }, [exitIsBurning, resetExitBurn]);

  const handleBurnAllConfirm = useCallback(() => {
    if (!burnAllDialogMode) {
      return;
    }
    requestBurnAll({ wipeIdentity: burnAllDialogMode === 'account' });
  }, [burnAllDialogMode, requestBurnAll]);

  const handleCloseBurnAllDialog = useCallback(() => {
    if (burnAllState === 'burning') {
      return;
    }
    setBurnAllDialogMode(null);
    resetBurnAll();
  }, [burnAllState, resetBurnAll]);

  const handlePanicCancel = useCallback(() => {
    setPanicToastOpen(false);
  }, []);

  const handlePanicExpire = useCallback(() => {
    setPanicToastOpen(false);
    requestBurnAll({ wipeIdentity: false });
  }, [requestBurnAll]);

  const panicGestureEnabled =
    prefs.panicGestureEnabled &&
    location.pathname === '/app' &&
    currentView === 'home' &&
    !panicToastOpen &&
    burnAllState !== 'burning';

  usePanicGesture({
    targetRef: panicBrandRef,
    enabled: panicGestureEnabled,
    onTrigger: () => setPanicToastOpen(true),
  });

  const handleVisibilityRestored = useCallback(() => {
    if (backgroundBurnPendingToastRef.current) {
      backgroundBurnPendingToastRef.current = false;
      notificationOccurred('warning');
      toast.warning(t('lifecycle.backgroundBurnMessage'), {
        title: t('lifecycle.backgroundBurnTitle'),
        duration: 6000,
      });
      fetchSessions();
      fetchRooms();
      return;
    }

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

    if (
      deps.hasActiveRoom
      && deps.activeRoomId
      && (deps.currentView === 'room-chat' || deps.currentView === 'room-manage')
    ) {
      if (membersVisibilityTimerRef.current !== null) {
        window.clearTimeout(membersVisibilityTimerRef.current);
      }
      membersVisibilityTimerRef.current = window.setTimeout(() => {
        membersVisibilityTimerRef.current = null;
        const latest = visibilitySyncDepsRef.current;
        if (
          latest.isConnected
          && latest.activeRoomId
          && (latest.currentView === 'room-chat' || latest.currentView === 'room-manage')
        ) {
          debugLog('info', '[App] Visibility restored — refreshing room members');
          latest.fetchMembers(latest.activeRoomId);
        }
      }, MEMBERS_VISIBILITY_DEBOUNCE_MS);
    }
  }, [notificationOccurred, toast, t, fetchSessions, fetchRooms]);

  useAppLifecycle({
    isConnected,
    publish,
    onVisibilityRestored: handleVisibilityRestored,
    onBackgroundKeysBurned: handleBackgroundKeysBurned,
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
      pendingRekeyResendRef.current = keyRefreshSessionId;
      handshakePeerRef.current = chat.peer;
      startHandshake(keyRefreshSessionId, chat.peer, true);
    } else {
      console.log('[App] Key refresh notification for non-active chat, ignoring:', keyRefreshSessionId);
    }
  }, [keyRefreshSessionId, clearKeyRefresh, startHandshake]);

  // Auto-resume handshake after WebSocket reconnect (IMP-VERUX-05)
  useEffect(() => {
    if (wsReconnectNonce === 0) return;
    if (!isConnected) return;
    if (lastHandshakeAutoResumeNonceRef.current === wsReconnectNonce) return;
    if (currentView !== 'handshake') return;
    if (!isHandshaking) return;
    if (handshakeResult.stage === 'complete') return;

    const sessionId = handshakeResult.sessionId;
    const peer = handshakePeerRef.current;
    if (!sessionId || !peer) return;

    lastHandshakeAutoResumeNonceRef.current = wsReconnectNonce;
    handshakeAutoResumeSessionRef.current = sessionId;

    console.log('[App] Auto-resume handshake after reconnect:', sessionId);
    toast.info(t('handshake.resumingConnection'), { duration: 3000 });
    resetHandshake();
    startHandshake(sessionId, peer, true);
  }, [
    wsReconnectNonce,
    isConnected,
    currentView,
    isHandshaking,
    handshakeResult.stage,
    handshakeResult.sessionId,
    resetHandshake,
    startHandshake,
    toast,
    t,
  ]);

  // Reset auto-resume guard when leaving handshake or session changes
  useEffect(() => {
    if (currentView !== 'handshake') {
      handshakeAutoResumeSessionRef.current = null;
    }
  }, [currentView]);

  useEffect(() => {
    if (
      handshakeResult.stage === 'complete'
      || handshakeResult.stage === 'idle'
      || handshakeResult.stage === 'error'
    ) {
      handshakeAutoResumeSessionRef.current = null;
    }
  }, [handshakeResult.stage]);

  const showWalletProvider =
    isReady &&
    !isAuthLoading &&
    isAuthenticated &&
    !initError &&
    !(wsError && !wsError.recoverable);

  const shouldMountWalletProvider =
    showWalletProvider && (environment === 'browser' || telegramWalletChromeRequested);

  const wrapWalletProvider = (children: ReactNode): ReactNode => {
    if (!shouldMountWalletProvider) {
      return children;
    }
    return (
      <WalletErrorBoundary>
        <Suspense fallback={children}>
          <LazyWalletProvider>{children}</LazyWalletProvider>
        </Suspense>
      </WalletErrorBoundary>
    );
  };

  // Loading state
  if (!isReady || isAuthLoading) {
    return wrapWalletProvider(
      <>
        <LoadingOverlay message="Loading BurnedChats..." />
      </>
    );
  }

  if (isJoinRoute) {
    if (joinRouteInvalid || !joinRouteToken) {
      return wrapWalletProvider(
        <>
          <JoinLanding valid={false} />
        </>
      );
    }

    if (environment === 'browser' && !isAuthenticated) {
      return wrapWalletProvider(
        <>
          <JoinLanding
            valid
            token={joinRouteToken}
            onOpenTelegram={() => {
              window.location.href = buildTelegramInviteDeepLink(joinRouteToken);
            }}
            onContinueInBrowser={() => void handleJoinBrowserLogin()}
            isLoginBusy={joinLoginBusy}
          />
        </>
      );
    }
  }

  if (environment === 'browser' && !isAuthenticated) {
    return wrapWalletProvider(
      <>
        <WalletLoginScreen />
      </>
    );
  }

  // Initialization error
  if (initError) {
    return wrapWalletProvider(
      <>
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
    return wrapWalletProvider(
      <>
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

  const burnAllChrome = (
    <>
      <BurnAllDialog
        mode={burnAllDialogMode ?? 'data'}
        open={burnAllDialogMode != null}
        isLoading={burnAllState === 'burning'}
        isOffline={!isConnected}
        onConfirm={handleBurnAllConfirm}
        onClose={handleCloseBurnAllDialog}
      />
      <PanicUndoToast
        open={panicToastOpen}
        countdownSeconds={3}
        onCancel={handlePanicCancel}
        onExpire={handlePanicExpire}
      />
      {showBurnAllComplete ? (
        <div className="burn-all-complete-overlay" onClick={() => setShowBurnAllComplete(false)}>
          <div className="burn-all-complete" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="burn-all-complete__title">{t('settings.burnAll.completeTitle')}</h2>
            <p className="burn-all-complete__description">{t('settings.burnAll.completeDescription')}</p>
            <button
              type="button"
              className="burn-all-complete__button"
              onClick={() => {
                setShowBurnAllComplete(false);
                resetBurnAll();
              }}
            >
              {t('settings.burnAll.completeButton')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  if (location.pathname.startsWith('/app/governance')) {
    return wrapWalletProvider(
      <>
        <Layout bottomNav={layoutBottomNav}>
          <Routes>
            <Route path="governance" element={<GovernancePage />}>
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
    return wrapWalletProvider(
      <>
        <Layout bottomNav={layoutBottomNav}>
          <StakingPage showSegmentBar />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  if (location.pathname.startsWith('/app/wallet')) {
    return wrapWalletProvider(
      <>
        <Layout bottomNav={layoutBottomNav}>
          <WalletPage />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  if (location.pathname.startsWith('/app/settings')) {
    return wrapWalletProvider(
      <>
        <Layout bottomNav={layoutBottomNav}>
          <SettingsPage
            user={user}
            linkedAccountsCredentials={linkedAccountsCredentials}
            onTonWalletChromeNeeded={requestTelegramWalletChrome}
            onBurnAllData={() => setBurnAllDialogMode('data')}
            onBurnAllAccount={() => setBurnAllDialogMode('account')}
            deadman={{
              deadman,
              isConnected,
              onSetDeadman: setDeadman,
            }}
            exit={{
              dialogOpen: exitDialogOpen,
              isBurning: exitIsBurning,
              error: exitBurnError,
              onOpenDialog: () => setExitDialogOpen(true),
              onCloseDialog: handleCloseExitDialog,
              onJustExit: handleJustExit,
              onBurnAndExit: startBurnAndExit,
              onRetryBurnAndExit: retryBurnAndExit,
            }}
          />
        </Layout>
        {debugPanelElement}
        {burnAllChrome}
      </>
    );
  }

  // Pending request view (waiting for recipient to accept)
  if (currentView === 'pending-request' && pendingSession) {
    return wrapWalletProvider(
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
    return wrapWalletProvider(
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
    const handshakeVisualFingerprint = handshakeResult.sessionId
      ? getSharedSecret(handshakeResult.sessionId)?.visualFingerprint ?? []
      : [];

    return wrapWalletProvider(
      <>
        <Layout>
          <HandshakeView
            result={handshakeResult}
            visualFingerprint={handshakeVisualFingerprint}
            onCancel={handleCancelHandshake}
            onContinue={handleHandshakeComplete}
            onRetry={handleRetryHandshake}
            onStartOver={handleStartOverHandshake}
            retryDisabled={handshakeRetryDisabled}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Verification view (visual fingerprint confirmation)
  if (currentView === 'verify' && activeChat) {
    const verificationVisualFingerprint =
      getSharedSecret(activeChat.sessionId)?.visualFingerprint ?? [];

    return wrapWalletProvider(
      <>
        <Layout>
          <VerificationView
            fingerprint={verificationVisualFingerprint}
            status={getVerificationStatus(activeChat.sessionId)}
            peer={activeChat.peer}
            sessionId={activeChat.sessionId}
            onConfirm={() => confirmVerification(activeChat.sessionId)}
            onMismatch={handleVerificationMismatch}
            onContinue={handleVerificationContinue}
            onCancel={handleVerificationCancel}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Chat view (active chat)
  if (currentView === 'chat' && activeChat && myInternalId !== null) {
    return wrapWalletProvider(
      <>
        <Layout fullBleed>
          <ChatViewContent
            sessionId={activeChat.sessionId}
            peer={activeChat.peer}
            userId={myInternalId}
            userTelegramId={telegramUserId ?? undefined}
            ws={{ isConnected, isReconnection, subscribe, unsubscribe, publish }}
            bothVerified={isFullyVerified(activeChat.sessionId)}
            rekeyResendNonce={rekeyResendNonce}
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
    return wrapWalletProvider(
      <>
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
    return wrapWalletProvider(
      <>
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

    return wrapWalletProvider(
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
  if (currentView === 'room-chat' && activeRoomChat && myInternalId !== null) {
    const activeRoom = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    const activeRoomRole = resolveActiveRoomRole(
      activeRoomMyRole,
      activeRoom,
      activeRoomChat.isOwner,
    );
    const isRoomOwner = activeRoomRole === 'owner';
    const isRoomModerator = canModerateRoom(activeRoomRole);

    return wrapWalletProvider(
      <>
        <Layout fullBleed>
          <RoomChatRoom
            roomId={activeRoomChat.roomId}
            epoch={activeRoomChat.epoch}
            nameEncrypted={activeRoom?.nameEncrypted}
            nameIv={activeRoom?.nameIv}
            userId={myInternalId}
            userTelegramId={telegramUserId ?? undefined}
            ws={roomChatWs}
            isOwner={isRoomOwner}
            canBypassReadOnly={isRoomModerator}
            isRequestingKey={isRequestingKey}
            onRequestKey={retryKeyRequest}
            rekeyStatus={rekeyMode === 'bootstrap' ? rekeyStatus : undefined}
            onOwnerRecoverKeys={isRoomOwner && activeRoomNeedsKey ? handleOwnerRecoverKeys : undefined}
            memberCount={
              activeRoomChat && !isMembersLoading ? roomMembers.length : undefined
            }
            onBack={() => {
              setActiveRoomChat(null);
              setRecoveryModalOpen(false);
              setCurrentView('home');
            }}
            onManage={isRoomModerator ? handleOpenRoomManage : undefined}
            onLeave={!isRoomOwner ? handleLeaveRoom : undefined}
            syncMessagesRef={roomSyncMessagesRef}
            roomReadOnly={roomReadOnly}
            isCurrentUserMuted={myInternalId != null && isRoomMemberMuted(myInternalId)}
            onRoomModeration={handleRoomModerationEvent}
            messageTtlSeconds={roomMessageTtlSeconds}
          />
          <RoomKeyRecoveryModal
            open={recoveryModalOpen}
            onClose={handleRecoveryModalClose}
            onConfirm={handleRecoveryConfirm}
            isLoading={isBootstrapRekeyInFlight}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Room manage view (P2-4.3.1) — owner and co-admin
  if (currentView === 'room-manage' && activeRoomChat) {
    const activeRoom = myRooms.find(r => r.roomId === activeRoomChat.roomId);
    const manageRole = resolveActiveRoomRole(
      activeRoomMyRole,
      activeRoom,
      activeRoomChat.isOwner,
    );

    const isManageOwner = manageRole === 'owner';

    if (!canModerateRoom(manageRole)) {
      return null;
    }

    return wrapWalletProvider(
      <>
        <Layout fullBleed>
          <RoomManageView
            roomId={activeRoomChat.roomId}
            myRole={manageRole}
            nameEncrypted={activeRoom?.nameEncrypted}
            nameIv={activeRoom?.nameIv}
            isRenaming={isRenamingRoom}
            renameError={renameRoomError}
            pendingRequestsCount={pendingJoinCount}
            members={roomMembers}
            isMembersLoading={isMembersLoading}
            currentUserInternalId={myInternalId ?? undefined}
            memberPresence={roomMemberPresence}
            onlineMemberCount={roomOnlineMemberCount}
            invites={roomInvites}
            isInvitesLoading={isInvitesLoading}
            invitesError={invitesError}
            isCreateInviteLoading={isInviteLoading}
            createInviteError={inviteError}
            onBack={() => {
              resetInviteLink();
              setCurrentView('room-chat');
            }}
            onRefreshInvites={handleRefreshInvites}
            onRevokeInvite={handleRevokeInvite}
            onCreateInviteLink={handleCreateInviteLink}
            onViewRequests={() => {
              setActiveRoomId(activeRoomChat.roomId);
              setRequestsReturnView('room-manage');
              setCurrentView('room-join-requests');
            }}
            onFetchMembers={() => fetchMembers(activeRoomChat.roomId)}
            onBurnRoom={handleBurnRoom}
            onRenameRoom={isManageOwner ? handleRenameRoom : undefined}
            onKickMember={handleKickMember}
            onBanMember={isManageOwner ? handleBanMember : undefined}
            bannedInternalIds={roomBans}
            isBansLoading={isBansLoading}
            bansError={isManageOwner ? bansError : null}
            onRefreshBans={isManageOwner ? handleRefreshBans : undefined}
            onUnban={isManageOwner ? handleUnbanMember : undefined}
            mutedInternalIds={roomMutedIds}
            roomReadOnly={roomReadOnly}
            onMuteMember={handleMuteMember}
            onUnmuteMember={handleUnmuteMember}
            onSetReadOnly={handleSetRoomReadOnly}
            onSetMemberRole={isManageOwner ? handleSetMemberRole : undefined}
            onTransferOwnership={isManageOwner ? transferOwnership : undefined}
            autoBurnAt={roomAutoBurnAt}
            onApplyTtlPreset={isManageOwner ? applyRoomTtlPreset : undefined}
            onApplyCustomTtlSeconds={isManageOwner ? applyCustomRoomTtlSeconds : undefined}
            messageTtlSeconds={roomMessageTtlSeconds}
            onApplyMessageTtlPreset={isManageOwner ? applyRoomMessageTtlPreset : undefined}
            onApplyCustomMessageTtlSeconds={isManageOwner ? applyCustomRoomMessageTtlSeconds : undefined}
          />
        </Layout>
        {debugPanelElement}
      </>
    );
  }

  // Default: Home view
  return wrapWalletProvider(
    <>
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
          panicBrandRef={panicBrandRef}
        />

        {/* Chat request dialog */}
        {showChatRequestDialog && selectedUser && (
          <ChatRequestDialog
            user={selectedUser}
            isLoading={isCreatingSession}
            error={sessionResult.error}
            errorMessage={sessionResult.errorMessage}
            powPhase={sessionPowPhase}
            powProgressIterations={sessionPowProgressIterations}
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
      {burnAllChrome}
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
  /** Whether both parties confirmed visual fingerprint verification */
  bothVerified: boolean;
  /** Bumped after DM rekey — triggers resend of queued own messages (IMP-OQR-02). */
  rekeyResendNonce?: number;
  onBack: () => void;
  onBurn: () => void;
  /**
   * Out-ref populated with the hook's `syncMessages` function so parents
   * (AppContent) can trigger an offline-queue sync from outside this component,
   * e.g. when the Mini App returns from background (FIX-SYNC-3).
   */
  syncMessagesRef?: MutableRefObject<(() => void) | null>;
}

function ChatViewContent({
  sessionId,
  peer,
  userId,
  userTelegramId,
  ws,
  bothVerified,
  rekeyResendNonce = 0,
  onBack,
  onBurn,
  syncMessagesRef,
}: ChatViewContentProps) {
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

  const handleSyncComplete = useCallback(
    (_count: number, failedCount?: number) => {
      if (failedCount && failedCount > 0) {
        toast.warning(t('chat.sync.undecryptable', { count: failedCount }), { duration: 8000 });
      }
    },
    [t, toast],
  );

  const { messages, sendMessage, sendFileMessage, isLoading, error, syncMessages, hideMessages, editMessage, deleteMessage } = useMessages({
    sessionId,
    userId,
    userTelegramId,
    ws,
    isReconnection: ws.isReconnection,
    bothVerified,
    rekeyResendNonce,
    onError: handleMessageError,
    onEditError: handleDmEditError,
    onSyncComplete: handleSyncComplete,
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

  const composerBlocked = !bothVerified || !!error;
  const composerBlockReason = !bothVerified
    ? t('chat.verificationRequired')
    : error
      ? t('chat.temporarilyUnavailable')
      : undefined;

  return (
    <ChatRoom
      userTelegramId={userTelegramId}
      sessionId={sessionId}
      peer={peer}
      messages={messages}
      isLoading={isLoading}
      isVerified={bothVerified}
      onSendMessage={handleSendMessage}
      onSendFile={handleSendFile}
      onBack={onBack}
      onBurn={onBurn}
      disabled={composerBlocked}
      errorMessage={composerBlockReason}
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
      <ToastProvider position="top" maxToasts={3}>
        <AuthContextProvider>
          <AppContent />
        </AuthContextProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

export default App;

