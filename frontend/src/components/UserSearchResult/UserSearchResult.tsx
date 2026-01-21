import type { SearchResult, UserInfo } from '../../types';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { StatusBadge } from '../StatusBadge';
import { LoaderIcon, AlertIcon, UserIcon } from '../../icons';
import './UserSearchResult.css';

interface UserSearchResultProps {
  /** Search result state */
  result: SearchResult;
  /** Callback when "Start Chat" button is clicked */
  onStartChat?: (user: UserInfo) => void;
  /** Whether to show loading state */
  isLoading?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Component to display user search results.
 * 
 * Shows different states:
 * - Searching: Loading spinner
 * - Found: User card with chat button
 * - Not found: Empty state message
 * - Error: Error message with retry option
 */
export function UserSearchResult({
  result,
  onStartChat,
  isLoading = false,
  className = '',
}: UserSearchResultProps) {
  const { status, user, error } = result;

  // Don't render anything in idle state
  if (status === 'idle') {
    return null;
  }

  return (
    <div className={`search-result ${className}`}>
      {/* Searching State */}
      {(status === 'searching' || isLoading) && (
        <div className="search-result__loading animate-fade-in">
          <LoaderIcon className="search-result__spinner" size={32} />
          <p className="search-result__text">Searching...</p>
        </div>
      )}

      {/* Found State */}
      {status === 'found' && user && !isLoading && (
        <Card className="search-result__card animate-slide-up">
          <CardContent>
            <div className="search-result__user">
              <Avatar
                src={user.photoUrl}
                name={user.displayName}
                size="lg"
              />
              <div className="search-result__user-info">
                <div className="search-result__user-header">
                  <h3 className="search-result__user-name">
                    {user.displayName}
                    {user.premium && (
                      <span className="search-result__premium" title="Premium">
                        ⭐
                      </span>
                    )}
                  </h3>
                  <StatusBadge
                    status={user.online ? 'online' : 'offline'}
                    size="sm"
                  />
                </div>
                {user.username && (
                  <p className="search-result__user-username">
                    @{user.username}
                  </p>
                )}
              </div>
            </div>
            <Button
              fullWidth
              onClick={() => onStartChat?.(user)}
              className="search-result__chat-button"
            >
              Start Secure Chat
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Not Found State */}
      {status === 'not_found' && !isLoading && (
        <div className="search-result__empty animate-fade-in">
          <UserIcon className="search-result__empty-icon" size={48} />
          <p className="search-result__text">User not found</p>
          <span className="search-result__hint">
            Make sure the username is correct or try searching by Telegram ID
          </span>
        </div>
      )}

      {/* Error State */}
      {status === 'error' && error && !isLoading && (
        <div className="search-result__error animate-fade-in">
          <AlertIcon className="search-result__error-icon" size={48} />
          <p className="search-result__text">{getErrorMessage(error)}</p>
          {error !== 'SELF_SEARCH' && (
            <span className="search-result__hint">
              Please try again or check your connection
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Get user-friendly error message
 */
function getErrorMessage(error: string): string {
  switch (error) {
    case 'SELF_SEARCH':
      return "You can't start a chat with yourself";
    case 'INVALID_QUERY':
      return 'Invalid username or ID format';
    case 'RATE_LIMITED':
      return 'Too many searches. Please wait a moment';
    case 'CONNECTION_ERROR':
      return 'Connection error. Please check your network';
    default:
      return 'An error occurred. Please try again';
  }
}
