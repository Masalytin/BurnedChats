// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from '@/preferences/preferencesStorage';
import { ONBOARDING_STORAGE_KEY, saveOnboardingProgress } from './onboarding';
import App from './App';

const { harness, noop, asyncNoop } = vi.hoisted(() => ({
  harness: {
    isReady: true,
    isAuthLoading: false,
    isAuthenticated: false,
    environment: 'browser' as 'browser' | 'telegram',
    wsError: null as { type: string; message: string; recoverable: boolean } | null,
  },
  noop: () => undefined,
  asyncNoop: async () => undefined,
}));

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: '',
    initDataUnsafe: { user: { language_code: 'en' } },
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    HapticFeedback: { notificationOccurred: vi.fn() },
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    themeParams: {},
  },
}));

vi.mock('./env/detector', () => ({
  getEnvironment: () => harness.environment,
  isTelegramMiniApp: () => harness.environment === 'telegram',
  isBrowser: () => harness.environment === 'browser',
}));

vi.mock('./auth', () => ({
  AuthContextProvider: ({ children }: { children: unknown }) => children,
  useAuthContext: () => ({
    user: harness.isAuthenticated
      ? { internalId: 'u1', displayName: 'Test', authType: 'WALLET' }
      : null,
    isLoading: harness.isAuthLoading,
    isAuthenticated: harness.isAuthenticated,
    login: asyncNoop,
    logout: noop,
    getCredentials: () => null,
    linkedWallet: null,
    applyLinkedAccounts: noop,
    refreshLinkedAccounts: asyncNoop,
  }),
}));

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: harness.isAuthenticated
      ? { internalId: 'u1', displayName: 'Test', authType: 'WALLET' }
      : null,
    isLoading: harness.isAuthLoading,
    isAuthenticated: harness.isAuthenticated,
    login: asyncNoop,
    logout: noop,
    getCredentials: () => null,
  }),
}));

vi.mock('./hooks/useTelegram', () => ({
  useTelegram: () => ({
    isReady: harness.isReady,
    isInTelegram: harness.environment === 'telegram',
    expand: noop,
    setClosingConfirmation: noop,
    setHeaderColor: noop,
    setBottomBarColor: noop,
    notificationOccurred: noop,
    openTelegramLink: noop,
    showScanQrPopup: async () => null,
    closeScanQrPopup: noop,
    showConfirm: async () => false,
    requestWriteAccess: asyncNoop,
    addToHomeScreen: noop,
    checkHomeScreenStatus: async () => 'unknown',
    startParam: undefined,
    close: noop,
  }),
}));

vi.mock('./hooks/useTelegramViewport', () => ({
  useTelegramViewport: noop,
}));

vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: false,
    isReconnection: false,
    isConnecting: false,
    error: harness.wsError,
    reconnectAttempt: 0,
    reconnectExhausted: false,
    connect: noop,
    disconnect: noop,
    subscribe: () => null,
    unsubscribe: noop,
    publish: noop,
    client: null,
    _debug: { activeSubscriptions: [], storedSubscriptions: [] },
  }),
}));

vi.mock('./hooks/useSearch', () => ({
  useSearch: () => ({
    query: '',
    setQuery: noop,
    result: null,
    search: noop,
    clearSearch: noop,
    isSearching: false,
  }),
}));

vi.mock('./hooks/useSession', () => ({
  useSession: () => ({
    result: { status: 'idle', session: null, error: null, errorMessage: null },
    createSession: noop,
    reset: noop,
    isCreating: false,
    powPhase: 'idle',
    powProgressIterations: 0,
  }),
}));

vi.mock('./hooks/useDmInvite', () => ({
  useDmInvite: () => ({
    mint: noop,
    redeem: noop,
    markRedeemed: noop,
    markRedeemFailed: noop,
    reset: noop,
    phase: 'idle',
    qrUrl: null,
    inviteUrl: null,
    errorMessage: null,
    powPhase: 'idle',
    powProgressIterations: 0,
  }),
}));

vi.mock('./hooks/useIncomingRequests', () => ({
  useIncomingRequests: () => ({
    requests: [],
    actionResult: { status: 'idle', error: null },
    acceptRequest: noop,
    rejectRequest: noop,
    clearRequest: noop,
    resetAction: noop,
  }),
}));

vi.mock('./hooks/useHandshake', () => ({
  useHandshake: () => ({
    result: {
      stage: 'idle',
      sessionId: null,
      peer: null,
      fingerprint: null,
      error: null,
      progress: 0,
    },
    startHandshake: noop,
    cancelHandshake: noop,
    reset: noop,
    isHandshaking: false,
    keyRefreshSessionId: null,
    clearKeyRefresh: noop,
  }),
  MAX_HANDSHAKE_MANUAL_RETRIES: 3,
  HANDSHAKE_RETRY_BASE_COOLDOWN_MS: 1000,
}));

vi.mock('./hooks/useVerification', () => ({
  useVerification: () => ({
    getStatus: () => null,
    confirmVerification: noop,
    reportMismatch: noop,
    isFullyVerified: () => false,
    clearStatus: noop,
  }),
}));

vi.mock('./hooks/useMyRooms', () => ({
  useMyRooms: () => ({
    rooms: [],
    isLoading: false,
    fetchRooms: noop,
    updateRoomName: noop,
    updateRoomRole: noop,
  }),
}));

vi.mock('./hooks/useSetRoomName', () => ({
  createRoomTopicMultiplexer: () => ({ subscribe: noop, unsubscribe: noop }),
  useSetRoomName: () => ({ setRoomName: noop }),
}));

vi.mock('./hooks/useCreateRoom', () => ({
  useCreateRoom: () => ({
    result: { status: 'idle', roomId: null, inviteUrl: null, error: null },
    createRoom: noop,
    reset: noop,
    isCreating: false,
  }),
}));

vi.mock('./hooks/useJoinRoom', () => ({
  useJoinRoom: () => ({
    result: { status: 'idle', joinMode: null, hasPassword: false, roomId: null, error: null },
    loadInviteInfo: noop,
    submitJoin: noop,
    reset: noop,
  }),
}));

vi.mock('./hooks/useRoomJoinRequests', () => ({
  useRoomJoinRequests: () => ({
    requests: [],
    pendingCount: 0,
    acceptRequest: noop,
    rejectRequest: noop,
    removeRequest: noop,
  }),
}));

vi.mock('./hooks/useKeyBundle', () => ({
  useKeyBundle: noop,
}));

vi.mock('./hooks/useRekeyRoom', () => ({
  useRekeyRoom: () => ({
    status: 'idle',
    errorReason: null,
    rekeyMode: null,
    rekeyRoom: noop,
    reset: noop,
  }),
}));

vi.mock('./hooks/useGetInviteLink', () => ({
  useGetInviteLink: () => ({
    inviteUrl: null,
    isLoading: false,
    error: null,
    getInviteLink: noop,
    reset: noop,
  }),
}));

vi.mock('./hooks/useManageInvites', () => ({
  useManageInvites: () => ({
    invites: [],
    isLoading: false,
    error: null,
    refresh: noop,
    revoke: noop,
  }),
}));

vi.mock('./hooks/useRoomMembers', () => ({
  useRoomMembers: () => ({
    members: [],
    isLoading: false,
    fetchMembers: noop,
    removeMember: noop,
    updateMemberRole: noop,
    applyOwnershipTransfer: noop,
  }),
}));

vi.mock('./hooks/useManageBans', () => ({
  useManageBans: () => ({
    bans: [],
    isLoading: false,
    error: null,
    refresh: noop,
    unban: noop,
    ban: noop,
  }),
}));

vi.mock('./hooks/useKickMember', () => ({
  useKickMember: () => ({ kick: noop }),
}));

vi.mock('./hooks/useActiveSessions', () => ({
  useActiveSessions: () => ({
    sessions: [],
    isLoading: false,
    fetchSessions: noop,
    resumeSession: noop,
    resumeResult: null,
    resetResume: noop,
  }),
}));

vi.mock('./hooks/useRoomRoles', () => ({
  useRoomRoles: () => ({
    myRole: null,
    setRole: noop,
    transferOwnership: noop,
  }),
}));

vi.mock('./hooks/useRoomModeration', () => ({
  useRoomModeration: () => ({
    readOnly: false,
    mutedIds: new Set<string>(),
    mute: noop,
    unmute: noop,
    setReadOnly: noop,
    handleModerationEvent: noop,
    isMuted: () => false,
  }),
}));

vi.mock('./hooks/useRoomTtl', () => ({
  useRoomTtl: () => ({
    autoBurnAt: null,
    applyPreset: noop,
    applyCustomSeconds: noop,
  }),
}));

vi.mock('./hooks/useRoomMessageTtl', () => ({
  useRoomMessageTtl: () => ({
    messageTtlSeconds: null,
    applyPreset: noop,
    applyCustomSeconds: noop,
  }),
}));

vi.mock('./hooks/useRoomPresence', () => ({
  useRoomPresence: () => ({
    presence: {},
    onlineCount: 0,
  }),
}));

vi.mock('./hooks/useRequestKeyBundle', () => ({
  useRequestKeyBundle: () => ({ isRequesting: false, retry: noop }),
}));

vi.mock('./hooks/useBurnAll', () => ({
  useBurnAll: () => ({
    burnAllState: 'idle',
    error: null,
    requestBurnAll: noop,
    resetBurnAll: noop,
  }),
}));

vi.mock('./hooks/useDeadmanSwitch', () => ({
  useDeadmanSwitch: () => ({ deadman: null, setDeadman: noop }),
}));

vi.mock('./hooks/useExitBurnFlow', () => ({
  useExitBurnFlow: () => ({
    isBurning: false,
    error: null,
    startBurnAndExit: noop,
    retryBurnAndExit: noop,
    resetExitBurn: noop,
  }),
}));

vi.mock('./hooks/useBackButton', () => ({
  useBackButton: noop,
}));

vi.mock('./hooks/useAppLifecycle', () => ({
  useAppLifecycle: noop,
}));

vi.mock('./hooks/usePanicGesture', () => ({
  usePanicGesture: noop,
}));

vi.mock('./components/DebugPanel', () => ({
  DebugPanel: () => <div data-testid="debug-panel">Debug Panel</div>,
  debugLog: vi.fn(),
}));

vi.mock('./pages/WalletPage', () => ({
  WalletPage: () => <div data-testid="wallet-page">Wallet</div>,
}));

vi.mock('./pages/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="settings-page">Settings</div>,
}));

vi.mock('./pages/HomePage', () => ({
  HomePage: () => <div data-testid="home-page" className="home-page">Home</div>,
}));

vi.mock('./components/Wallet/LazyWalletProvider', () => ({
  LazyWalletProvider: ({ children }: { children: unknown }) => children,
}));

function setPanelEnabled(enabled: boolean): void {
  savePreferences({ ...getDefaultPreferences(), debugPanelEnabled: enabled });
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <App />
    </MemoryRouter>,
  );
}

function resetHarness(): void {
  harness.isReady = true;
  harness.isAuthLoading = false;
  harness.isAuthenticated = false;
  harness.environment = 'browser';
  harness.wsError = null;
}

const APP_SOURCE = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');

describe('App debug panel mount on early-return screens (IMP-DBGPANEL-07)', () => {
  beforeEach(() => {
    resetHarness();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    setPanelEnabled(false);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  });

  it('does not mount Debug Panel on WalletLoginScreen even when debugPanelEnabled', () => {
    setPanelEnabled(true);
    harness.environment = 'browser';
    harness.isAuthenticated = false;
    harness.isReady = true;
    harness.isAuthLoading = false;

    renderApp();

    expect(document.querySelector('.wallet-login-screen')).not.toBeNull();
    expect(screen.queryByTestId('debug-panel')).toBeNull();
  });

  it('mounts Debug Panel on fatal Connection Error when debugPanelEnabled', () => {
    setPanelEnabled(true);
    harness.environment = 'telegram';
    harness.isAuthenticated = true;
    harness.isReady = true;
    harness.isAuthLoading = false;
    harness.wsError = {
      type: 'connection_error',
      message: 'Fatal WS failure',
      recoverable: false,
    };

    renderApp();

    expect(screen.getByText('Connection Error')).toBeTruthy();
    expect(screen.getByText('Fatal WS failure')).toBeTruthy();
    expect(screen.getByTestId('debug-panel')).toBeTruthy();
  });

  it('does not mount Debug Panel on WalletLogin or fatal WS when the flag is off', () => {
    setPanelEnabled(false);
    harness.environment = 'browser';
    harness.isAuthenticated = false;

    const login = renderApp();
    expect(document.querySelector('.wallet-login-screen')).not.toBeNull();
    expect(screen.queryByTestId('debug-panel')).toBeNull();
    login.unmount();

    harness.environment = 'telegram';
    harness.isAuthenticated = true;
    harness.wsError = {
      type: 'auth_error',
      message: 'Auth failed',
      recoverable: false,
    };
    renderApp();
    expect(screen.getByText('Connection Error')).toBeTruthy();
    expect(screen.queryByTestId('debug-panel')).toBeNull();
  });

  it('does not mount Debug Panel on the loading overlay even when the flag is on', () => {
    setPanelEnabled(true);
    harness.isReady = false;
    harness.isAuthLoading = false;

    renderApp();

    expect(screen.getByText('Loading BurnedChats...')).toBeTruthy();
    expect(screen.queryByTestId('debug-panel')).toBeNull();
  });

  it('initError early-return tree includes debugPanelElement (hoisted factory)', () => {
    const factoryIdx = APP_SOURCE.indexOf('const debugPanelElement = prefs.debugPanelEnabled');
    const initIdx = APP_SOURCE.indexOf('if (initError)');
    const initBlock = APP_SOURCE.match(/\/\/ Initialization error\s+if \(initError\) \{([\s\S]*?)\n  \}/);

    expect(factoryIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(-1);
    expect(factoryIdx).toBeLessThan(initIdx);
    expect(initBlock?.[1]).toContain('debugPanelElement');
  });

  it('WalletLoginScreen early return does not include debugPanelElement', () => {
    const loginIdx = APP_SOURCE.indexOf('<WalletLoginScreen />');
    expect(loginIdx).toBeGreaterThan(-1);
    const nearby = APP_SOURCE.slice(Math.max(0, loginIdx - 220), loginIdx + 80);
    expect(nearby).toContain('WalletLoginScreen');
    expect(nearby).not.toContain('debugPanelElement');
  });
});

describe('App BottomNavBar top-level routing', () => {
  beforeEach(() => {
    resetHarness();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setPanelEnabled(false);
    saveOnboardingProgress({ v: 1, seen: { briefing: true } });
    harness.isAuthenticated = true;
    harness.environment = 'browser';
    harness.isReady = true;
    harness.isAuthLoading = false;
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  });

  function renderSplatApp(path = '/app') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/*" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders WalletPage when BottomNavBar Wallet is clicked (splat /app/*)', () => {
    renderSplatApp();

    expect(screen.getByTestId('home-page')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Wallet' }));

    expect(screen.getByTestId('wallet-page')).toBeTruthy();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });

  it('renders SettingsPage when BottomNavBar Settings is clicked (splat /app/*)', () => {
    renderSplatApp();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByTestId('settings-page')).toBeTruthy();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });

  it('still switches tabs when the debug panel flag is on', () => {
    setPanelEnabled(true);
    renderSplatApp();

    fireEvent.click(screen.getByRole('tab', { name: 'Wallet' }));

    expect(screen.getByTestId('wallet-page')).toBeTruthy();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });

  it('hides BottomNavBar while the first-run briefing is open', () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    renderSplatApp();

    expect(screen.getByRole('button', { name: i18n.t('home.onboardingContinue') })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelector('.bottom-nav')).toBeNull();
  });

  it('shows BottomNavBar after the briefing is dismissed', () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    renderSplatApp();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('home.onboardingContinue') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('home.onboardingQuiz.skip') }));

    expect(screen.queryByRole('button', { name: i18n.t('home.onboardingContinue') })).toBeNull();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(document.querySelector('.bottom-nav')).not.toBeNull();
  });
});
