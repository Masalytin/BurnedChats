import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SearchResult, UserInfo } from '../../types';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { PresenceBadge } from '../PresenceBadge';
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
  const { t } = useTranslation();
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
          <p className="search-result__text">{t('userSearch.searching')}</p>
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
                      <span className="search-result__premium" title={t('common.premium')}>
                        <Star size={14} aria-hidden="true" />
                      </span>
                    )}
                  </h3>
                  <PresenceBadge
                    internalId={user.internalId}
                    snapshotOnline={user.online}
                    live={false}
                    size="sm"
                  />
                </div>
                {user.username ? (
                  <p className="search-result__user-username">
                    @{user.username}
                  </p>
                ) : user.walletAddress ? (
                  <p className="search-result__user-username search-result__user-wallet">
                    {user.walletAddress}
                  </p>
                ) : (
                  <p className="search-result__user-username search-result__user-wallet">
                    {t('userSearch.walletUser')}
                  </p>
                )}
              </div>
            </div>
            <Button
              fullWidth
              onClick={() => onStartChat?.(user)}
              className="search-result__chat-button"
            >
              {t('userSearch.startChat')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Not Found State */}
      {status === 'not_found' && !isLoading && (
        <div className="search-result__empty animate-fade-in">
          <UserIcon className="search-result__empty-icon" size={48} />
          <p className="search-result__text">{t('userSearch.notFound')}</p>
          <span className="search-result__hint">
            {t('userSearch.notFoundHint')}
          </span>
        </div>
      )}

      {/* Error State */}
      {status === 'error' && error && !isLoading && (
        <div className="search-result__error animate-fade-in">
          <AlertIcon className="search-result__error-icon" size={48} />
          <p className="search-result__text">{getErrorMessage(error, t)}</p>
          {error !== 'SELF_SEARCH' && (
            <span className="search-result__hint">
              {t('userSearch.errorHint')}
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
function getErrorMessage(error: string, t: (key: string) => string): string {
  const key = `userSearch.errors.${error}`;
  const message = t(key);
  return message !== key ? message : t('userSearch.errors.DEFAULT');
}
