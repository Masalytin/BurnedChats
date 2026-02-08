import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import type { TelegramUser } from '../hooks/useTelegram';
import type { ActiveSession } from '../hooks/useActiveSessions';
import type { SearchResult, UserInfo } from '../types';
import { Avatar, Button, Card, CardContent, StatusBadge, Input, UserSearchResult, SessionCard, PullToRefresh } from '../components';
import { FlameIcon, SearchIcon, ShieldIcon, CloseIcon, CopyIcon } from '../icons';
import './HomePage.css';

interface HomePageProps {
  user: TelegramUser | null;
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
}: HomePageProps) {
  const [localQuery, setLocalQuery] = useState('');
  
  // Use controlled or uncontrolled query
  const query = onSearchQueryChange ? searchQuery : localQuery;
  const setQuery = onSearchQueryChange || setLocalQuery;

  const displayName = user 
    ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
    : 'Anonymous';

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
            <StatusBadge 
              status={connectionStatus} 
              size="sm"
            />
            {isConnecting && reconnectAttempt > 0 && (
              <span className="reconnect-indicator">
                Retry {reconnectAttempt}
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
              src={user?.photo_url} 
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
                {user && (
                  <span className="home-profile-id-row">
                    <span className="home-profile-id-label">ID: {user.id}</span>
                    <button
                      type="button"
                      className="home-profile-copy"
                      onClick={() => handleCopy(String(user.id), 'ID')}
                      aria-label="Copy ID"
                      title="Copy ID"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Section */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h3 className="home-section-title">Start a Secure Chat</h3>
        <form className="home-search" onSubmit={handleSearchSubmit}>
          <Input 
            placeholder="Search by @username or ID"
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
          <Button 
            type="submit"
            fullWidth 
            disabled={!isConnected || !query.trim()}
            isLoading={isSearching}
          >
            Search User
          </Button>
        </form>

        {/* Search Results */}
        <UserSearchResult
          result={searchResult}
          isLoading={isSearching}
          onStartChat={onStartChat}
        />
      </section>

      {/* Features Section */}
      <section className="home-features animate-slide-up" style={{ animationDelay: '200ms' }}>
        <FeatureItem 
          icon={<ShieldIcon />}
          title="End-to-End Encrypted"
          description="Messages are encrypted on your device. Even we can't read them."
        />
        <FeatureItem 
          icon={<FlameIcon />}
          title="Burn After Reading"
          description="Destroy all traces of your conversation with one tap."
        />
      </section>

      {/* Active Sessions List (4.6.7) with Pull-to-Refresh (4.6.12) */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '300ms' }}>
        <h3 className="home-section-title">Active Sessions</h3>
        
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
              <p>No active sessions</p>
              <span>Pull down to refresh</span>
            </div>
          )}
        </PullToRefresh>
      </section>
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


