import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ClipboardList,
  Flame,
  Home,
  Link,
  Pencil,
  Settings,
  User,
  UserMinus,
  Users,
} from 'lucide-react';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { Input } from '../Input';
import { CopyIcon } from '../../icons';
import { formatShortRoomId, resolveRoomDisplayName } from '../../crypto/groupKey';
import type { RoomInvite } from '../../hooks/useManageInvites';
import type { GetInviteLinkOptions } from '../../hooks/useGetInviteLink';
import type { RoomMember } from '../../types';
import './RoomManageView.css';

/** Max invite rows shown before collapsing the rest. */
const MAX_VISIBLE_INVITES = 10;

/** Backend max TTL (30 days) — used for the "no expiry" preset. */
const NO_EXPIRY_SECONDS = 30 * 24 * 3600;

type ExpiryPreset = '1h' | '24h' | '7d' | 'none';
type LimitPreset = '1' | '5' | '10' | 'unlimited';

const EXPIRY_PRESET_SECONDS: Record<ExpiryPreset, number | undefined> = {
  '1h': 3600,
  '24h': 86400,
  '7d': 604800,
  none: NO_EXPIRY_SECONDS,
};

const LIMIT_PRESET_VALUES: Record<LimitPreset, number | undefined> = {
  '1': 1,
  '5': 5,
  '10': 10,
  unlimited: undefined,
};

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

function formatRemainingDuration(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isUnlimitedUses(maxUses: number | null | undefined): boolean {
  return maxUses == null || maxUses <= 0;
}

interface InviteRowProps {
  invite: RoomInvite;
  onCopy: (url: string) => void;
  onRevoke: (token: string) => void;
  copiedUrl: string | null;
}

function InviteRow({ invite, onCopy, onRevoke, copiedUrl }: InviteRowProps) {
  const { t } = useTranslation();
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.floor((invite.expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.floor((invite.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [invite.expiresAt]);

  const usesLabel = isUnlimitedUses(invite.maxUses)
    ? t('room.invite.usesUnlimited', { used: invite.usedCount })
    : t('room.invite.usesLeft', { used: invite.usedCount, max: invite.maxUses });

  return (
    <li className="room-manage-invite-row">
      <div className="room-manage-invite-row__info">
        <span className="room-manage-invite-row__url" title={invite.url}>{invite.url}</span>
        <div className="room-manage-invite-row__meta">
          <span>{t('room.invite.expiresIn', { time: formatRemainingDuration(remainingSeconds) })}</span>
          <span className="room-manage-invite-row__dot" aria-hidden="true">·</span>
          <span>{usesLabel}</span>
        </div>
      </div>
      <div className="room-manage-invite-row__actions">
        <button
          type="button"
          className={`room-manage-invite__copy ${copiedUrl === invite.url ? 'room-manage-invite__copy--copied' : ''}`}
          onClick={() => onCopy(invite.url)}
          aria-label={t('common.copy')}
        >
          <CopyButtonIcon />
          {copiedUrl === invite.url ? t('common.copied') : t('common.copy')}
        </button>
        <button
          type="button"
          className="room-manage-invite-row__revoke"
          onClick={() => onRevoke(invite.token)}
        >
          {t('room.invite.revoke')}
        </button>
      </div>
    </li>
  );
}

function shortInternalId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function CopyButtonIcon() {
  return <CopyIcon size={16} aria-hidden="true" />;
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
  nameEncrypted?: string | null;
  nameIv?: string | null;
  isRenaming?: boolean;
  renameError?: string | null;
  /** Pending join requests count (for badge) */
  pendingRequestsCount?: number;
  /** Enriched room members from GET_ROOM_MEMBERS */
  members?: RoomMember[];
  isMembersLoading?: boolean;
  /** Current user's internal id — highlights "You" on the member row */
  currentUserInternalId?: string;
  /** Active invite links for this room */
  invites?: RoomInvite[];
  isInvitesLoading?: boolean;
  invitesError?: string | null;
  isCreateInviteLoading?: boolean;
  createInviteError?: string | null;
  /** Callbacks */
  onBack?: () => void;
  onRefreshInvites?: () => void;
  onRevokeInvite?: (token: string) => void;
  onCreateInviteLink?: (options: GetInviteLinkOptions) => void;
  onViewRequests: () => void;
  onFetchMembers: () => void;
  onBurnRoom: () => void;
  /** Owner renames the room (encrypted client-side). */
  onRenameRoom?: (name: string) => void;
  /** Owner removes a member (IMP-ROOM-04) */
  onKickMember?: (targetInternalId: string) => void;
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
  isOwner,
  nameEncrypted,
  nameIv,
  isRenaming = false,
  renameError,
  pendingRequestsCount = 0,
  members,
  isMembersLoading = false,
  currentUserInternalId,
  invites = [],
  isInvitesLoading = false,
  invitesError,
  isCreateInviteLoading = false,
  createInviteError,
  onBack,
  onRefreshInvites,
  onRevokeInvite,
  onCreateInviteLink,
  onViewRequests,
  onFetchMembers,
  onBurnRoom,
  onRenameRoom,
  onKickMember,
}: RoomManageViewProps) {
  const { t } = useTranslation();

  const [copiedInviteUrl, setCopiedInviteUrl] = useState<string | null>(null);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [kickTarget, setKickTarget] = useState<{ internalId: string; displayName: string } | null>(null);
  const [displayTitle, setDisplayTitle] = useState(() => formatShortRoomId(roomId));
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('7d');
  const [limitPreset, setLimitPreset] = useState<LimitPreset>('unlimited');
  const [showAllInvites, setShowAllInvites] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void resolveRoomDisplayName(roomId, nameEncrypted, nameIv).then((label) => {
      if (!cancelled) {
        setDisplayTitle(label);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, nameEncrypted, nameIv]);

  useEffect(() => {
    if (!isEditingName) {
      setEditNameValue(displayTitle === formatShortRoomId(roomId) ? '' : displayTitle);
    }
  }, [displayTitle, isEditingName, roomId]);

  // Load invites when manage view mounts
  useEffect(() => {
    onRefreshInvites?.();
  }, [onRefreshInvites]);

  // Auto-fetch members when section is expanded
  useEffect(() => {
    if (membersExpanded && !members?.length && !isMembersLoading) {
      onFetchMembers();
    }
  }, [membersExpanded, members?.length, isMembersLoading, onFetchMembers]);

  const handleCopyInviteUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteUrl(url);
      setTimeout(() => setCopiedInviteUrl(null), 2000);
    } catch {
      // Fallback: select text manually
    }
  }, []);

  const handleCreateInvite = useCallback(() => {
    if (!onCreateInviteLink) return;
    const options: GetInviteLinkOptions = {};
    const expiresInSeconds = EXPIRY_PRESET_SECONDS[expiryPreset];
    if (expiresInSeconds != null) {
      options.expiresInSeconds = expiresInSeconds;
    }
    const maxUses = LIMIT_PRESET_VALUES[limitPreset];
    if (maxUses != null) {
      options.maxUses = maxUses;
    }
    onCreateInviteLink(options);
  }, [onCreateInviteLink, expiryPreset, limitPreset]);

  const handleRevokeInvite = useCallback((token: string) => {
    onRevokeInvite?.(token);
  }, [onRevokeInvite]);

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

  const handleKickClick = useCallback((member: RoomMember) => {
    const displayName = member.displayName?.trim()
      || t('room.manage.memberFallback', { id: shortInternalId(member.internalId) });
    setKickTarget({ internalId: member.internalId, displayName });
  }, [t]);

  const handleKickConfirm = useCallback(() => {
    if (kickTarget && onKickMember) {
      onKickMember(kickTarget.internalId);
    }
    setKickTarget(null);
  }, [kickTarget, onKickMember]);

  const handleKickCancel = useCallback(() => {
    setKickTarget(null);
  }, []);

  const handleStartRename = useCallback(() => {
    setEditNameValue(displayTitle === formatShortRoomId(roomId) ? '' : displayTitle);
    setIsEditingName(true);
  }, [displayTitle, roomId]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
    setEditNameValue(displayTitle === formatShortRoomId(roomId) ? '' : displayTitle);
  }, [displayTitle, roomId]);

  const handleSaveRename = useCallback(() => {
    const trimmed = editNameValue.trim();
    if (!trimmed || !onRenameRoom) return;
    onRenameRoom(trimmed);
    setIsEditingName(false);
  }, [editNameValue, onRenameRoom]);

  const roomShortId = formatShortRoomId(roomId);

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
            {displayTitle}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="room-manage-view__content">

        {isOwner && onRenameRoom && (
          <section className="room-manage-section">
            <h3 className="room-manage-section__heading">
              <Pencil size={16} aria-hidden="true" />
              {t('room.manage.nameLabel')}
            </h3>
            <div className="room-manage-section__body">
              {isEditingName ? (
                <div className="room-manage-rename">
                  <Input
                    type="text"
                    label={t('room.manage.nameLabel')}
                    placeholder={t('room.manage.namePlaceholder')}
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    disabled={isRenaming}
                    autoComplete="off"
                    maxLength={64}
                  />
                  <div className="room-manage-rename__actions">
                    <Button
                      variant="secondary"
                      onClick={handleCancelRename}
                      disabled={isRenaming}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      onClick={handleSaveRename}
                      isLoading={isRenaming}
                      disabled={!editNameValue.trim() || isRenaming}
                    >
                      {t('room.manage.renameSave')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="room-manage-rename-display">
                  <span className="room-manage-rename-display__value">{displayTitle}</span>
                  <Button variant="secondary" onClick={handleStartRename}>
                    {t('room.manage.renameButton')}
                  </Button>
                </div>
              )}
              {renameError && (
                <p className="room-manage-section__error" role="alert">{renameError}</p>
              )}
              <p className="room-manage-rename__hint">{roomShortId}</p>
            </div>
          </section>
        )}

        {/* ── Invite links ─────────────────────────────── */}
        <section className="room-manage-section">
          <h3 className="room-manage-section__heading">
            <Link size={16} aria-hidden="true" />
            {t('room.manage.invitesTitle')}
          </h3>
          <div className="room-manage-section__body room-manage-invites">
            {isInvitesLoading && invites.length === 0 ? (
              <p className="room-manage-invites__loading">{t('common.loading')}</p>
            ) : invites.length === 0 ? (
              <p className="room-manage-invites__empty">{t('room.manage.invitesEmpty')}</p>
            ) : (
              <>
                <ul className="room-manage-invites__list">
                  {(showAllInvites ? invites : invites.slice(0, MAX_VISIBLE_INVITES)).map(invite => (
                    <InviteRow
                      key={invite.token}
                      invite={invite}
                      onCopy={handleCopyInviteUrl}
                      onRevoke={handleRevokeInvite}
                      copiedUrl={copiedInviteUrl}
                    />
                  ))}
                </ul>
                {invites.length > MAX_VISIBLE_INVITES && !showAllInvites && (
                  <button
                    type="button"
                    className="room-manage-invites__more"
                    onClick={() => setShowAllInvites(true)}
                  >
                    {t('room.manage.invitesMore', { count: invites.length - MAX_VISIBLE_INVITES })}
                  </button>
                )}
              </>
            )}
            {invitesError && (
              <p className="room-manage-section__error" role="alert">{invitesError}</p>
            )}

            {onCreateInviteLink && (
              <div className="room-manage-invites-create">
                <h4 className="room-manage-invites-create__title">{t('room.invite.createTitle')}</h4>
                <div className="room-manage-invites-create__group">
                  <span className="room-manage-invites-create__label">{t('room.invite.createExpiryLabel')}</span>
                  <div className="room-manage-invites-create__presets" role="group" aria-label={t('room.invite.createExpiryLabel')}>
                    {(['1h', '24h', '7d', 'none'] as ExpiryPreset[]).map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`room-manage-invites-create__chip ${expiryPreset === key ? 'room-manage-invites-create__chip--active' : ''}`}
                        onClick={() => setExpiryPreset(key)}
                      >
                        {t(`room.invite.createExpiry${key === 'none' ? 'None' : key}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="room-manage-invites-create__group">
                  <span className="room-manage-invites-create__label">{t('room.invite.createLimitLabel')}</span>
                  <div className="room-manage-invites-create__presets" role="group" aria-label={t('room.invite.createLimitLabel')}>
                    {(['1', '5', '10', 'unlimited'] as LimitPreset[]).map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`room-manage-invites-create__chip ${limitPreset === key ? 'room-manage-invites-create__chip--active' : ''}`}
                        onClick={() => setLimitPreset(key)}
                      >
                        {t(`room.invite.createLimit${key === 'unlimited' ? 'Unlimited' : key}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleCreateInvite}
                  disabled={isCreateInviteLoading}
                  fullWidth
                >
                  {isCreateInviteLoading ? t('common.loading') : t('room.invite.createButton')}
                </Button>
                {createInviteError && (
                  <p className="room-manage-section__error" role="alert">{createInviteError}</p>
                )}
              </div>
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
                  {members.map(member => {
                    const isYou = member.internalId === currentUserInternalId;
                    const canKick = onKickMember != null
                      && member.role !== 'owner'
                      && !isYou;

                    return (
                      <RoomMemberRow
                        key={member.internalId}
                        member={member}
                        isYou={isYou}
                        actions={canKick ? (
                          <button
                            type="button"
                            className="room-member-row__kick-btn"
                            onClick={() => handleKickClick(member)}
                            aria-label={t('room.manage.kickButton', { name: member.displayName?.trim() || member.internalId })}
                          >
                            <UserMinus size={16} aria-hidden="true" />
                            <span className="room-member-row__kick-label">{t('room.manage.kickButton')}</span>
                          </button>
                        ) : undefined}
                      />
                    );
                  })}
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

      {kickTarget && (
        <ConfirmDialog
          isOpen
          onClose={handleKickCancel}
          onConfirm={handleKickConfirm}
          title={t('room.manage.kickConfirmTitle', { name: kickTarget.displayName })}
          description={t('room.manage.kickConfirmDescription')}
          warning={t('room.manage.kickConfirmWarning')}
          confirmLabel={t('room.manage.kickConfirmButton')}
          variant="destructive"
          iconType="delete"
        />
      )}

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
