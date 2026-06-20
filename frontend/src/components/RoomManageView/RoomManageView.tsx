import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ClipboardList,
  Flame,
  Home,
  Link,
  Settings,
  User,
  Users,
} from 'lucide-react';
import { Button } from '../Button';
import { CopyIcon } from '../../icons';
import type { RoomMember } from '../../types';
import './RoomManageView.css';

// ============================================
// Sub-components
// ============================================

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyButtonIcon() {
  return <CopyIcon size={16} aria-hidden="true" />;
}

function shortInternalId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function memberInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ============================================
// Reusable member row (kick/roles/presence hooks later)
// ============================================

export interface RoomMemberRowProps {
  member: RoomMember;
  isYou?: boolean;
  actions?: ReactNode;
}

export function RoomMemberRow({ member, isYou = false, actions }: RoomMemberRowProps) {
  const { t } = useTranslation();
  const displayName = member.displayName?.trim();
  const label = displayName
    || t('room.manage.memberFallback', { id: shortInternalId(member.internalId) });

  return (
    <li className="room-member-row">
      <div
        className={`room-member-row__avatar ${displayName ? 'room-member-row__avatar--initials' : ''}`}
        aria-hidden="true"
      >
        {displayName ? (
          <span className="room-member-row__initials">{memberInitials(displayName)}</span>
        ) : (
          <User size={16} />
        )}
      </div>
      <div className="room-member-row__info">
        <span className="room-member-row__name">{label}</span>
        <div className="room-member-row__meta">
          {isYou && (
            <span className="room-member-row__you">{t('room.manage.memberYou')}</span>
          )}
          {member.role === 'owner' && (
            <span className="room-member-row__badge">{t('room.manage.roleOwner')}</span>
          )}
        </div>
      </div>
      {actions != null && (
        <div className="room-member-row__actions">{actions}</div>
      )}
    </li>
  );
}

// ============================================
// Props
// ============================================

interface RoomManageViewProps {
  roomId: string;
  /** Whether the current user is the room owner */
  isOwner: boolean;
  /** Pending join requests count (for badge) */
  pendingRequestsCount?: number;
  /** Enriched room members from GET_ROOM_MEMBERS */
  members?: RoomMember[];
  isMembersLoading?: boolean;
  /** Current user's internal id — highlights "You" on the member row */
  currentUserInternalId?: string;
  /** Current invite URL (null if not fetched yet) */
  inviteUrl?: string | null;
  isInviteLoading?: boolean;
  inviteError?: string | null;
  /** Callbacks */
  onBack?: () => void;
  onGetInviteLink: () => void;
  onViewRequests: () => void;
  onFetchMembers: () => void;
  onBurnRoom: () => void;
}

// ============================================
// Component
// ============================================

/**
 * RoomManageView — owner-only room management screen (P2-4.3.1).
 *
 * Sections:
 * - Invite: request & copy invite link
 * - Requests: navigate to join-requests view
 * - Members: list of member tgIds
 * - Burn Room: confirmation dialog + BURN_ROOM
 */
export const RoomManageView = memo(function RoomManageView({
  roomId,
  pendingRequestsCount = 0,
  members,
  isMembersLoading = false,
  currentUserInternalId,
  inviteUrl,
  isInviteLoading = false,
  inviteError,
  onBack,
  onGetInviteLink,
  onViewRequests,
  onFetchMembers,
  onBurnRoom,
}: RoomManageViewProps) {
  const { t } = useTranslation();

  const [copied, setCopied] = useState(false);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [membersExpanded, setMembersExpanded] = useState(false);

  // Auto-fetch members when section is expanded
  useEffect(() => {
    if (membersExpanded && !members?.length && !isMembersLoading) {
      onFetchMembers();
    }
  }, [membersExpanded, members?.length, isMembersLoading, onFetchMembers]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text manually
    }
  }, [inviteUrl]);

  const handleBurnClick = useCallback(() => {
    setShowBurnConfirm(true);
  }, []);

  const handleBurnConfirm = useCallback(() => {
    setShowBurnConfirm(false);
    onBurnRoom();
  }, [onBurnRoom]);

  const handleBurnCancel = useCallback(() => {
    setShowBurnConfirm(false);
  }, []);

  const roomShortId = roomId.length > 12 ? `${roomId.slice(0, 8)}…` : roomId;

  return (
    <div className="room-manage-view">
      {/* Header */}
      <div className="room-manage-view__header">
        {onBack && (
          <button
            type="button"
            className="room-manage-view__back"
            onClick={onBack}
            aria-label={t('common.back')}
          >
            <BackIcon />
          </button>
        )}
        <div className="room-manage-view__header-info">
          <h2 className="room-manage-view__title">
            <Settings size={18} className="room-manage-view__title-icon" aria-hidden="true" />
            {t('room.manage.title')}
          </h2>
          <p className="room-manage-view__subtitle">
            <Home size={14} aria-hidden="true" />
            {roomShortId}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="room-manage-view__content">

        {/* ── Invite link ─────────────────────────────── */}
        <section className="room-manage-section">
          <h3 className="room-manage-section__heading">
            <Link size={16} aria-hidden="true" />
            {t('room.manage.inviteButton')}
          </h3>
          <div className="room-manage-section__body">
            {inviteUrl ? (
              <div className="room-manage-invite">
                <span className="room-manage-invite__url">{inviteUrl}</span>
                <button
                  type="button"
                  className={`room-manage-invite__copy ${copied ? 'room-manage-invite__copy--copied' : ''}`}
                  onClick={handleCopyInvite}
                  aria-label={t('common.copy')}
                >
                  <CopyButtonIcon />
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={onGetInviteLink}
                disabled={isInviteLoading}
                fullWidth
              >
                {isInviteLoading ? t('common.loading') : t('room.manage.inviteButton')}
              </Button>
            )}
            {inviteError && (
              <p className="room-manage-section__error">{inviteError}</p>
            )}
          </div>
        </section>

        {/* ── Join requests ────────────────────────────── */}
        <section className="room-manage-section">
          <button
            type="button"
            className="room-manage-nav-item"
            onClick={onViewRequests}
          >
            <span className="room-manage-nav-item__label">
              <ClipboardList size={18} aria-hidden="true" />
              {t('room.manage.requestsButton')}
            </span>
            {pendingRequestsCount > 0 && (
              <span className="room-manage-nav-item__badge">{pendingRequestsCount}</span>
            )}
            <ChevronRight size={18} className="room-manage-nav-item__arrow" aria-hidden="true" />
          </button>
        </section>

        {/* ── Members ──────────────────────────────────── */}
        <section className="room-manage-section">
          <button
            type="button"
            className="room-manage-nav-item"
            onClick={() => setMembersExpanded(v => !v)}
          >
            <span className="room-manage-nav-item__label">
              <Users size={18} aria-hidden="true" />
              {t('room.manage.membersTitle')}
            </span>
            {members && members.length > 0 && (
              <span className="room-manage-nav-item__badge">{members.length}</span>
            )}
            <ChevronRight
              size={18}
              className={`room-manage-nav-item__arrow ${membersExpanded ? 'room-manage-nav-item__arrow--open' : ''}`}
              aria-hidden="true"
            />
          </button>

          {membersExpanded && (
            <div className="room-manage-members">
              {isMembersLoading ? (
                <p className="room-manage-members__loading">{t('common.loading')}</p>
              ) : members && members.length > 0 ? (
                <ul className="room-manage-members__list">
                  {members.map(member => (
                    <RoomMemberRow
                      key={member.internalId}
                      member={member}
                      isYou={member.internalId === currentUserInternalId}
                    />
                  ))}
                </ul>
              ) : (
                <p className="room-manage-members__empty">{t('room.manage.membersEmpty')}</p>
              )}
            </div>
          )}
        </section>

        {/* ── Burn room ────────────────────────────────── */}
        <section className="room-manage-section room-manage-section--danger">
          <Button
            variant="secondary"
            className="room-manage-burn-btn"
            onClick={handleBurnClick}
            fullWidth
            leftIcon={<Flame size={18} aria-hidden="true" />}
          >
            {t('room.manage.burnButton')}
          </Button>
        </section>
      </div>

      {/* Burn confirmation overlay */}
      {showBurnConfirm && (
        <div className="room-manage-burn-dialog-overlay" role="dialog" aria-modal="true">
          <div className="room-manage-burn-dialog">
            <div className="room-manage-burn-dialog__icon" aria-hidden="true">
              <Flame size={48} strokeWidth={1.5} />
            </div>
            <h3 className="room-manage-burn-dialog__title">{t('room.manage.burnConfirmTitle')}</h3>
            <p className="room-manage-burn-dialog__text">{t('room.manage.burnConfirmText')}</p>
            <div className="room-manage-burn-dialog__actions">
              <Button variant="secondary" onClick={handleBurnCancel} fullWidth>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                className="room-manage-burn-dialog__confirm-btn"
                onClick={handleBurnConfirm}
                fullWidth
              >
                {t('room.manage.burnButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
