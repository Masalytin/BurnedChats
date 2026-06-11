import { useState, useCallback, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../auth';
import type { ActiveSession } from '../hooks/useActiveSessions';
import type { RoomListEntry, SearchResult, UserInfo } from '../types';
import { Avatar, Button, Card, CardContent, StatusBadge, Input, UserSearchResult, SessionCard, PullToRefresh } from '../components';
import { RoomCard } from '../components/RoomCard';
import { BalanceChip } from '../components/Wallet/BalanceChip';
import { FlameIcon, SearchIcon, ShieldIcon, CloseIcon, CopyIcon, RefreshIcon, ArrowUpIcon, LockIcon } from '../icons';
import './HomePage.css';

interface HomePageProps {
  user: AuthUser | null;
  isConnected: boolean;
  isConnecting?: boolean;
  reconnectAttempt?: number;
  /** Search query value */
  searchQuery?: string;
  /** Set search query */
  onSearchQueryChange?: (query: string) => void;
  /** Search result state */
  searchResult?: SearchResult;
  /** Execute search */
  onSearch?: (query?: string) => void;
  /** Clear search */
  onClearSearch?: () => void;
  /** Whether search is in progress */
  isSearching?: boolean;
  /** Callback when user wants to start chat */
  onStartChat?: (user: UserInfo) => void;
  /** Active sessions list (4.6.7) */
  activeSessions?: ActiveSession[];
  /** Whether sessions are loading */
  isLoadingSessions?: boolean;
  /** Callback when user clicks on a session (4.6.8) */
  onSessionClick?: (session: ActiveSession) => void;
  /** Session currently being resumed */
  resumingSessionId?: string | null;
  /** Callback to refresh sessions list (4.6.12) */
  onRefreshSessions?: () => void;
  /** Callback when user wants to burn a session (4.6.11) */
  onBurnSession?: (sessionId: string, peerName: string) => void;
  /** Session currently being burned (4.6.11) */
  burningSessionId?: string | null;
  /** Callback when user clicks "Create Room" */
  onCreateRoom?: () => void;
  /** List of rooms user participates in (P2-4.1.2) */
  rooms?: RoomListEntry[];
  /** Whether the rooms list is loading */
  isLoadingRooms?: boolean;
  /** Callback when user clicks a room card */
  onRoomClick?: (roomId: string) => void;
  /** Callback to refresh rooms list */
  onRefreshRooms?: () => void;
  /** Callback to refresh all data (rooms + sessions) */
  onRefreshAll?: () => void;
  /** Telegram MA: request mounting wallet chrome (staking/governance navigation). */
  onTonWalletChromeNeeded?: () => void;
}

/** Default search result state */
const defaultSearchResult: SearchResult = {
  status: 'idle',
  user: null,
  error: null,
};

/**
 * Main home page component with search functionality
 */
export function HomePage({ 
  user, 
  isConnected, 
  isConnecting = false,
  reconnectAttempt = 0,
  searchQuery = '',
  onSearchQueryChange,
  searchResult = defaultSearchResult,
  onSearch,
  onClearSearch,
  isSearching = false,
  onStartChat,
  activeSessions = [],
  isLoadingSessions = false,
  onSessionClick,
  resumingSessionId = null,
  onRefreshSessions,
  onBurnSession,
  burningSessionId = null,
  onCreateRoom,
  rooms = [],
  isLoadingRooms = false,
  onRoomClick,
  onRefreshRooms,
  onRefreshAll,
  onTonWalletChromeNeeded,
}: HomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState('');
  const [showFab, setShowFab] = useState(false);

  // Show FAB after scrolling down 150px (scroll container is .layout-main)
  useEffect(() => {
    const container = document.querySelector('.layout-main');
    if (!container) return;
    const handleScroll = () => {
      setShowFab(container.scrollTop >= 150);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScrollToTopRefresh = useCallback(() => {
    const container = document.querySelector('.layout-main');
    container?.scrollTo({ top: 0, behavior: 'smooth' });
    onRefreshAll?.();
  }, [onRefreshAll]);
  
  // Use controlled or uncontrolled query
  const query = onSearchQueryChange ? searchQuery : localQuery;
  const setQuery = onSearchQueryChange || setLocalQuery;

  const displayName = user?.displayName ?? 'Anonymous';

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        // Optional: could use toast if available
        if (typeof document !== 'undefined' && document.hasFocus()) {
          const el = document.createElement('span');
          el.setAttribute('aria-live', 'polite');
          el.className = 'home-copy-feedback';
          el.textContent = `${label} copied`;
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 1500);
        }
      },
      () => {}
    );
  }, []);

  // Determine connection status
  const connectionStatus = isConnected 
    ? 'online' 
    : isConnecting 
      ? 'connecting' 
      : 'offline';

  // Handle search form submission
  const handleSearchSubmit = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    if (query.trim() && onSearch) {
      onSearch(query);
    }
  }, [query, onSearch]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSubmit();
    }
  }, [handleSearchSubmit]);

  // Handle clear search
  const handleClearSearch = useCallback(() => {
    setQuery('');
    onClearSearch?.();
  }, [setQuery, onClearSearch]);

  const handleBurnNav = useCallback(
    (path: '/app/staking' | '/app/governance') => {
      onTonWalletChromeNeeded?.();
      navigate(path);
    },
    [navigate, onTonWalletChromeNeeded],
  );

  // Show clear button when there's text or results
  const showClearButton = query.length > 0 || searchResult.status !== 'idle';

  return (
    <div className="home-page">
      {/* Header */}
      <header className="home-header">
        <div className="home-header-content">
          <div className="home-brand">
            <FlameIcon className="home-brand-icon" />
            <h1 className="home-title">BurnedChats</h1>
          </div>
          <div className="home-status">
            <BalanceChip />
            <StatusBadge 
              status={connectionStatus} 
              size="sm"
            />
            {isConnecting && reconnectAttempt > 0 && (
              <span className="reconnect-indicator">
                {t('common.retry', { count: reconnectAttempt })}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* User Profile Card */}
      <Card className="home-profile-card animate-slide-up">
        <CardContent>
          <div className="home-profile">
            <Avatar 
              src={user?.avatarUrl} 
              name={displayName} 
              size="lg"
            />
            <div className="home-profile-info">
              <h2 className="home-profile-name">{displayName}</h2>
              <div className="home-profile-ids">
                {user?.username && (
                  <span className="home-profile-id-row">
                    <span className="home-profile-id-label">@{user.username}</span>
                    <button
                      type="button"
                      className="home-profile-copy"
                      onClick={() => handleCopy(`@${user.username}`, 'Username')}
                      aria-label="Copy username"
                      title="Copy username"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </span>
                )}
                {user?.telegramId ? (
                  <span className="home-profile-id-row">
                    <span className="home-profile-id-label">TG ID: {user.telegramId}</span>
                    <button
                      type="button"
                      className="home-profile-copy"
                      onClick={() => handleCopy(String(user.telegramId), 'Telegram ID')}
                      aria-label="Copy ID"
                      title="Copy ID"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </span>
                ) : null}
                {user?.internalId ? (
                  <span className="home-profile-id-row">
                    <span className="home-profile-id-label">{t('home.internalIdLabel', { id: user.internalId })}</span>
                    <button
                      type="button"
                      className="home-profile-copy"
                      onClick={() => handleCopy(user.internalId, 'Internal ID')}
                      aria-label="Copy internal id"
                      title="Copy internal id"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BURN Token — Staking & Governance entry points (IMP-STKGOV-01) */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '90ms' }}>
        <h3 className="home-section-title">{t('home.burnSection.title')}</h3>
        <p className="home-burn-section-subtitle">{t('home.burnSection.subtitle')}</p>
        <div className="home-burn-actions">
          <button
            type="button"
            className="home-burn-action"
            onClick={() => handleBurnNav('/app/staking')}
          >
            <span className="home-burn-action-icon home-burn-action-icon--staking" aria-hidden="true">
              <LockIcon size={20} />
            </span>
            <span className="home-burn-action-text">
              <span className="home-burn-action-title">{t('home.burnSection.staking')}</span>
              <span className="home-burn-action-desc">{t('home.burnSection.stakingDesc')}</span>
            </span>
          </button>
          <button
            type="button"
            className="home-burn-action"
            onClick={() => handleBurnNav('/app/governance')}
          >
            <span className="home-burn-action-icon home-burn-action-icon--governance" aria-hidden="true">
              <ShieldIcon size={20} />
            </span>
            <span className="home-burn-action-text">
              <span className="home-burn-action-title">{t('home.burnSection.governance')}</span>
              <span className="home-burn-action-desc">{t('home.burnSection.governanceDesc')}</span>
            </span>
          </button>
        </div>
      </section>

      {/* Search Section */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h3 className="home-section-title">{t('home.sectionSearch')}</h3>
        <form className="home-search" onSubmit={handleSearchSubmit}>
          <Input 
            placeholder={t('home.searchPlaceholder')}
            leftIcon={<SearchIcon size={20} />}
            rightIcon={showClearButton ? (
              <button 
                type="button" 
                className="home-search-clear"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <CloseIcon size={18} />
              </button>
            ) : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <p className="home-search-hint">{t('home.searchHint')}</p>
          <Button 
            type="submit"
            fullWidth 
            disabled={!isConnected || !query.trim()}
            isLoading={isSearching}
          >
            {t('home.searchButton')}
          </Button>
        </form>

        {/* Search Results */}
        <UserSearchResult
          result={searchResult}
          isLoading={isSearching}
          onStartChat={onStartChat}
        />
      </section>

      {/* Rooms Section (P2-4.1.2) */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '150ms' }}>
        <div className="home-section-header">
          <h3 className="home-section-title">{t('room.sectionMyRooms')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bc-spacing-xs)' }}>
            <button
              type="button"
              className={`home-refresh-btn${isLoadingRooms ? ' home-refresh-btn--spinning' : ''}`}
              onClick={onRefreshRooms}
              disabled={!isConnected || isLoadingRooms}
              aria-label={t('aria.refreshRooms')}
              title={t('aria.refreshRooms')}
            >
              <RefreshIcon size={16} />
            </button>
            <Button
              variant="primary"
              size="sm"
              disabled={!isConnected}
              onClick={onCreateRoom}
            >
              {t('room.createRoomButton')}
            </Button>
          </div>
        </div>

        {isLoadingRooms && (
          <div className="session-list">
            <RoomCardSkeleton />
            <RoomCardSkeleton />
          </div>
        )}

        {!isLoadingRooms && rooms.length > 0 && (
          <div className="session-list">
            {rooms.map((room) => (
              <RoomCard
                key={room.roomId}
                room={room}
                onClick={onRoomClick}
              />
            ))}
          </div>
        )}

        {!isLoadingRooms && rooms.length === 0 && (
          <div className="home-empty-state">
            <p>{t('room.emptyRooms')}</p>
          </div>
        )}
      </section>

      {/* Features Section */}
      <section className="home-features animate-slide-up" style={{ animationDelay: '200ms' }}>
        <FeatureItem 
          icon={<ShieldIcon />}
          title={t('home.featureE2eeTitle')}
          description={t('home.featureE2eeDesc')}
        />
        <FeatureItem 
          icon={<FlameIcon />}
          title={t('home.featureBurnTitle')}
          description={t('home.featureBurnDesc')}
        />
      </section>

      {/* Active Sessions List (4.6.7) with Pull-to-Refresh (4.6.12) */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '300ms' }}>
        <div className="home-section-header">
          <h3 className="home-section-title">{t('home.sectionSessions')}</h3>
          <button
            type="button"
            className={`home-refresh-btn${isLoadingSessions ? ' home-refresh-btn--spinning' : ''}`}
            onClick={() => onRefreshSessions?.()}
            disabled={!isConnected || isLoadingSessions}
            aria-label={t('aria.refreshSessions')}
            title={t('aria.refreshSessions')}
          >
            <RefreshIcon size={16} />
          </button>
        </div>
        
        <PullToRefresh
          onRefresh={() => onRefreshSessions?.()}
          isRefreshing={isLoadingSessions}
          disabled={!isConnected}
          className="sessions-pull-to-refresh"
        >
          {/* Loading state */}
          {isLoadingSessions && (
            <div className="session-list">
              <SessionCardSkeleton />
              <SessionCardSkeleton />
            </div>
          )}

          {/* Sessions list */}
          {!isLoadingSessions && activeSessions.length > 0 && (
            <div className="session-list">
              {activeSessions.map((session) => (
                <SessionCard
                  key={session.sessionId}
                  session={session}
                  onClick={() => onSessionClick?.(session)}
                  onBurn={onBurnSession}
                  isLoading={resumingSessionId === session.sessionId}
                  isBurning={burningSessionId === session.sessionId}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoadingSessions && activeSessions.length === 0 && (
            <div className="home-empty-state">
              <p>{t('home.noSessions')}</p>
              <span>{t('home.pullToRefresh')}</span>
            </div>
          )}
        </PullToRefresh>
      </section>
      {/* Scroll-to-top + refresh FAB */}
      <button
        type="button"
        className={`home-scroll-top-fab${showFab ? '' : ' home-scroll-top-fab--hidden'}`}
        onClick={handleScrollToTopRefresh}
        aria-label={t('aria.scrollToTopRefresh')}
        title={t('aria.scrollToTopRefresh')}
      >
        <ArrowUpIcon size={20} />
      </button>
    </div>
  );
}

interface FeatureItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureItem({ icon, title, description }: FeatureItemProps) {
  return (
    <div className="feature-item">
      <div className="feature-icon">{icon}</div>
      <div className="feature-content">
        <h4 className="feature-title">{title}</h4>
        <p className="feature-description">{description}</p>
      </div>
    </div>
  );
}

/**
 * Skeleton loader for SessionCard (4.6.7)
 */
function SessionCardSkeleton() {
  return (
    <div className="session-card-skeleton">
      <div className="session-card-skeleton-avatar" />
      <div className="session-card-skeleton-content">
        <div className="session-card-skeleton-line session-card-skeleton-line--short" />
        <div className="session-card-skeleton-line session-card-skeleton-line--medium" />
      </div>
    </div>
  );
}

/**
 * Skeleton loader for RoomCard (P2-4.1.2)
 */
function RoomCardSkeleton() {
  return (
    <div className="session-card-skeleton">
      <div className="session-card-skeleton-avatar" />
      <div className="session-card-skeleton-content">
        <div className="session-card-skeleton-line session-card-skeleton-line--medium" />
        <div className="session-card-skeleton-line session-card-skeleton-line--short" />
      </div>
    </div>
  );
}


