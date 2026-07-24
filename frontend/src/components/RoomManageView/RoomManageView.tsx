import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ClipboardList,
  Clock,
  Crown,
  Flame,
  Home,
  Link,
  MicOff,
  Pencil,
  Settings,
  Share2,
  Shield,
  ShieldBan,
  ShieldMinus,
  Timer,
  User,
  UserMinus,
  Users,
  Volume2,
} from 'lucide-react';
import { getEnvironment } from '../../env/detector';
import { useTelegram } from '../../hooks/useTelegram';
import { buildTelegramShareUrl } from '../../utils/inviteLink';
import {
  ROOM_TTL_PRESETS,
  ROOM_TTL_CUSTOM_MIN_SECONDS,
  ROOM_TTL_CUSTOM_MAX_SECONDS,
  matchRoomTtlPreset,
  type RoomTtlPreset,
} from '../../hooks/useRoomTtl';
import {
  MESSAGE_TTL_PRESETS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  matchMessageTtlPreset,
  type MessageTtlPreset,
} from '../../hooks/useRoomMessageTtl';
import { Button } from '../Button';
import { Input } from '../Input';
import { DurationField } from '../DurationField';
import { validateDurationSeconds } from '../../utils/duration';
import { ConfirmDialog } from '../ConfirmDialog';
import { CopyIcon } from '../../icons';
import { formatShortRoomId, resolveRoomDisplayName } from '../../crypto/groupKey';
import type { RoomInvite } from '../../hooks/useManageInvites';
import type { GetInviteLinkOptions } from '../../hooks/useGetInviteLink';
import type { RoomMember, RoomRole } from '../../types';
import {
  formatPresenceRelativeTime,
  type MemberPresence,
} from '../../hooks/useRoomPresence';
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

/** Invite expiry bounds — mirror backend InviteTokenService / API.md. */
const INVITE_EXPIRY_MIN_SECONDS = 60;
const INVITE_EXPIRY_MAX_SECONDS = 30 * 24 * 3600;

/** UX soft-cap for invite maxUses (backend accepts any positive Integer). */
const INVITE_LIMIT_MIN = 1;
const INVITE_LIMIT_MAX = 10_000;

type LimitValidationResult =
  | 'ok'
  | 'empty'
  | 'nan'
  | 'not-integer'
  | 'below-min'
  | 'above-max';

function matchExpiryPreset(seconds: number): ExpiryPreset | null {
  for (const [preset, presetSeconds] of Object.entries(EXPIRY_PRESET_SECONDS) as [
    ExpiryPreset,
    number | undefined,
  ][]) {
    if (presetSeconds != null && presetSeconds === seconds) {
      return preset;
    }
  }
  return null;
}

function matchLimitPreset(maxUses: number): LimitPreset | null {
  for (const [preset, value] of Object.entries(LIMIT_PRESET_VALUES) as [
    LimitPreset,
    number | undefined,
  ][]) {
    if (value != null && value === maxUses) {
      return preset;
    }
  }
  return null;
}

function parseLimitInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateLimitValue(value: number | null): LimitValidationResult {
  if (value === null) {
    return 'empty';
  }
  if (Number.isNaN(value)) {
    return 'nan';
  }
  if (!Number.isInteger(value)) {
    return 'not-integer';
  }
  if (value < INVITE_LIMIT_MIN) {
    return 'below-min';
  }
  if (value > INVITE_LIMIT_MAX) {
    return 'above-max';
  }
  return 'ok';
}

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
  /** Decrypted room title for share text; null when title is unavailable. */
  roomTitle: string | null;
}

function InviteRow({ invite, onCopy, onRevoke, copiedUrl, roomTitle }: InviteRowProps) {
  const { t } = useTranslation();
  const { openTelegramLink, impactOccurred } = useTelegram();
  const showShare = getEnvironment() === 'telegram';
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

  const handleShare = useCallback(() => {
    const text = roomTitle
      ? t('room.invite.shareMessage', { title: roomTitle })
      : t('room.invite.shareMessageGeneric');
    impactOccurred('light');
    openTelegramLink(buildTelegramShareUrl(invite.url, text));
  }, [impactOccurred, invite.url, openTelegramLink, roomTitle, t]);

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
        {showShare && (
          <button
            type="button"
            className="room-manage-invite__share"
            onClick={handleShare}
            aria-label={t('room.invite.share')}
          >
            <Share2 size={16} aria-hidden="true" />
            {t('room.invite.share')}
          </button>
        )}
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
  presence?: MemberPresence;
  /** Bumps on interval so relative last-seen labels stay fresh. */
  presenceTick?: number;
  actions?: ReactNode;
}

export function RoomMemberRow({
  member,
  isYou = false,
  presence,
  presenceTick = 0,
  actions,
}: RoomMemberRowProps) {
  const { t } = useTranslation();
  const displayName = member.displayName?.trim();
  const label = displayName
    || t('room.manage.memberFallback', { id: shortInternalId(member.internalId) });

  void presenceTick;

  const presenceLabel = presence?.online
    ? t('room.manage.online')
    : presence?.lastSeen != null
      ? t('room.manage.lastSeen', {
        time: formatPresenceRelativeTime(presence.lastSeen, t),
      })
      : null;

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
          {presence?.online && (
            <span className="room-member-row__presence room-member-row__presence--online">
              <span className="room-member-row__online-dot" aria-hidden="true" />
              {t('room.manage.online')}
            </span>
          )}
          {!presence?.online && presenceLabel != null && (
            <span className="room-member-row__last-seen">{presenceLabel}</span>
          )}
          {isYou && (
            <span className="room-member-row__you">{t('room.manage.memberYou')}</span>
          )}
          {member.role === 'owner' && (
            <span className="room-member-row__badge room-member-row__badge--owner">
              {t('room.manage.roleOwner')}
            </span>
          )}
          {member.role === 'admin' && (
            <span className="room-member-row__badge room-member-row__badge--admin">
              {t('room.manage.roleAdmin')}
            </span>
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
  /** Current user's role in this room */
  myRole: RoomRole;
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
  /** Member presence map from useRoomPresence (IMP-ROOM-21) */
  memberPresence?: Map<string, MemberPresence>;
  /** Count of online members for header badge */
  onlineMemberCount?: number;
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
  /** Owner permanently bans a member (IMP-ROOM-10) */
  onBanMember?: (targetInternalId: string) => void;
  /** Banned internal IDs for this room */
  bannedInternalIds?: string[];
  isBansLoading?: boolean;
  bansError?: string | null;
  onRefreshBans?: () => void;
  onUnban?: (targetInternalId: string) => void;
  /** Muted member internal IDs (IMP-ROOM-12) */
  mutedInternalIds?: string[];
  /** Room read-only flag */
  roomReadOnly?: boolean;
  onMuteMember?: (targetInternalId: string) => void;
  onUnmuteMember?: (targetInternalId: string) => void;
  onSetReadOnly?: (readOnly: boolean) => void;
  /** Owner-only: promote/demote co-admin overlay */
  onSetMemberRole?: (targetInternalId: string, role: 'admin' | 'member') => void;
  /** Owner-only: transfer room ownership */
  onTransferOwnership?: (targetInternalId: string) => void;
  /** Owner-only: managed room auto-burn deadline (epoch ms), from ROOM_TTL_UPDATED */
  autoBurnAt?: number | null;
  /** Owner-only: apply a TTL preset via `/app/room.setTtl` */
  onApplyTtlPreset?: (preset: RoomTtlPreset) => void;
  /** Owner-only: apply a custom TTL in seconds via `/app/room.setTtl` (IMP-RCV-02) */
  onApplyCustomTtlSeconds?: (ttlSeconds: number) => void;
  /** Owner-only: current message auto-destruction TTL in seconds (IMP-ROOM-19) */
  messageTtlSeconds?: number;
  /** Owner-only: apply a message TTL preset via `/app/room.setMessageTtl` */
  onApplyMessageTtlPreset?: (preset: MessageTtlPreset) => void;
  /** Owner-only: apply a custom message TTL in seconds (IMP-RCV-03) */
  onApplyCustomMessageTtlSeconds?: (messageTtlSeconds: number) => void;
}

// ============================================
// Component
// ============================================

/**
 * RoomManageView — room management screen for owners and co-admins (P2-4.3.1, IMP-ROOM-15).
 *
 * Sections:
 * - Invite: request & copy invite link
 * - Requests: navigate to join-requests view
 * - Members: list of member tgIds
 * - Burn Room: confirmation dialog + BURN_ROOM
 */
export const RoomManageView = memo(function RoomManageView({
  roomId,
  myRole,
  nameEncrypted,
  nameIv,
  isRenaming = false,
  renameError,
  pendingRequestsCount = 0,
  members,
  isMembersLoading = false,
  currentUserInternalId,
  memberPresence,
  onlineMemberCount = 0,
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
  onBanMember,
  bannedInternalIds = [],
  isBansLoading = false,
  bansError,
  onRefreshBans,
  onUnban,
  mutedInternalIds = [],
  roomReadOnly = false,
  onMuteMember,
  onUnmuteMember,
  onSetReadOnly,
  onSetMemberRole,
  onTransferOwnership,
  autoBurnAt = null,
  onApplyTtlPreset,
  onApplyCustomTtlSeconds,
  messageTtlSeconds = 0,
  onApplyMessageTtlPreset,
  onApplyCustomMessageTtlSeconds,
}: RoomManageViewProps) {
  const { t } = useTranslation();

  const isOwner = myRole === 'owner';
  const isModerator = myRole === 'owner' || myRole === 'admin';

  const [copiedInviteUrl, setCopiedInviteUrl] = useState<string | null>(null);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [bansExpanded, setBansExpanded] = useState(false);
  const [kickTarget, setKickTarget] = useState<{ internalId: string; displayName: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ internalId: string; displayName: string } | null>(null);
  const [banPermanently, setBanPermanently] = useState(false);
  const [displayTitle, setDisplayTitle] = useState(() => formatShortRoomId(roomId));
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('7d');
  const [limitPreset, setLimitPreset] = useState<LimitPreset>('unlimited');
  const [isCustomExpiryExpanded, setIsCustomExpiryExpanded] = useState(false);
  const [customExpirySeconds, setCustomExpirySeconds] = useState<number | null>(null);
  const [isCustomLimitExpanded, setIsCustomLimitExpanded] = useState(false);
  const [customLimitInput, setCustomLimitInput] = useState('');
  const [showAllInvites, setShowAllInvites] = useState(false);
  const [autoBurnRemainingSec, setAutoBurnRemainingSec] = useState(() =>
    autoBurnAt != null
      ? Math.max(0, Math.floor((autoBurnAt - Date.now()) / 1000))
      : 0,
  );
  const [isCustomTtlExpanded, setIsCustomTtlExpanded] = useState(false);
  const [customTtlSeconds, setCustomTtlSeconds] = useState<number | null>(null);
  const [isCustomMsgTtlExpanded, setIsCustomMsgTtlExpanded] = useState(false);
  const [customMsgTtlSeconds, setCustomMsgTtlSeconds] = useState<number | null>(null);
  const [presenceTick, setPresenceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPresenceTick(tick => tick + 1);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoBurnAt == null) {
      setAutoBurnRemainingSec(0);
      return;
    }
    const tick = () => {
      setAutoBurnRemainingSec(Math.max(0, Math.floor((autoBurnAt - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [autoBurnAt]);

  const activeTtlPreset = matchRoomTtlPreset(autoBurnAt);
  const activeMessageTtlPreset = matchMessageTtlPreset(messageTtlSeconds);

  const isCustomTtlActive =
    activeTtlPreset === null && autoBurnAt != null;
  const showCustomTtlPanel = isCustomTtlExpanded || isCustomTtlActive;

  const isCustomMsgTtlActive =
    activeMessageTtlPreset === null && messageTtlSeconds > 0;
  const showCustomMsgTtlPanel = isCustomMsgTtlExpanded || isCustomMsgTtlActive;

  const customTtlValidation = validateDurationSeconds(customTtlSeconds, {
    min: ROOM_TTL_CUSTOM_MIN_SECONDS,
    max: ROOM_TTL_CUSTOM_MAX_SECONDS,
  });
  const canApplyCustomTtl =
    customTtlValidation === 'ok' && customTtlSeconds != null && onApplyCustomTtlSeconds != null;

  const customMsgTtlValidation = validateDurationSeconds(customMsgTtlSeconds, {
    min: MESSAGE_TTL_CUSTOM_MIN_SECONDS,
    max: MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  });
  const canApplyCustomMsgTtl =
    customMsgTtlValidation === 'ok'
    && customMsgTtlSeconds != null
    && onApplyCustomMessageTtlSeconds != null;

  useEffect(() => {
    if (activeTtlPreset !== null) {
      setIsCustomTtlExpanded(false);
      return;
    }
    if (autoBurnAt != null) {
      setIsCustomTtlExpanded(true);
      setCustomTtlSeconds(Math.max(0, Math.floor((autoBurnAt - Date.now()) / 1000)));
    }
  }, [activeTtlPreset, autoBurnAt]);

  useEffect(() => {
    if (activeMessageTtlPreset !== null) {
      setIsCustomMsgTtlExpanded(false);
      return;
    }
    if (messageTtlSeconds > 0) {
      setIsCustomMsgTtlExpanded(true);
      setCustomMsgTtlSeconds(messageTtlSeconds);
    }
  }, [activeMessageTtlPreset, messageTtlSeconds]);

  const handleSelectTtlPreset = useCallback((preset: RoomTtlPreset) => {
    setIsCustomTtlExpanded(false);
    onApplyTtlPreset?.(preset);
  }, [onApplyTtlPreset]);

  const handleSelectCustomTtl = useCallback(() => {
    setIsCustomTtlExpanded(true);
    if (autoBurnAt != null && autoBurnRemainingSec > 0) {
      setCustomTtlSeconds(autoBurnRemainingSec);
    } else {
      setCustomTtlSeconds(null);
    }
  }, [autoBurnAt, autoBurnRemainingSec]);

  const handleApplyCustomTtl = useCallback(() => {
    if (!canApplyCustomTtl || customTtlSeconds == null) {
      return;
    }
    onApplyCustomTtlSeconds?.(customTtlSeconds);
  }, [canApplyCustomTtl, customTtlSeconds, onApplyCustomTtlSeconds]);

  const handleSelectMessageTtlPreset = useCallback((preset: MessageTtlPreset) => {
    setIsCustomMsgTtlExpanded(false);
    onApplyMessageTtlPreset?.(preset);
  }, [onApplyMessageTtlPreset]);

  const handleSelectCustomMsgTtl = useCallback(() => {
    setIsCustomMsgTtlExpanded(true);
    if (messageTtlSeconds > 0 && activeMessageTtlPreset === null) {
      setCustomMsgTtlSeconds(messageTtlSeconds);
    } else {
      setCustomMsgTtlSeconds(null);
    }
  }, [messageTtlSeconds, activeMessageTtlPreset]);

  const handleApplyCustomMsgTtl = useCallback(() => {
    if (!canApplyCustomMsgTtl || customMsgTtlSeconds == null) {
      return;
    }
    onApplyCustomMessageTtlSeconds?.(customMsgTtlSeconds);
  }, [canApplyCustomMsgTtl, customMsgTtlSeconds, onApplyCustomMessageTtlSeconds]);

  const customExpiryValidation = validateDurationSeconds(customExpirySeconds, {
    min: INVITE_EXPIRY_MIN_SECONDS,
    max: INVITE_EXPIRY_MAX_SECONDS,
  });
  const parsedCustomLimit = parseLimitInput(customLimitInput);
  const customLimitValidation = validateLimitValue(parsedCustomLimit);
  const matchedExpiryPreset =
    customExpiryValidation === 'ok' && customExpirySeconds != null
      ? matchExpiryPreset(customExpirySeconds)
      : null;
  const matchedLimitPreset =
    customLimitValidation === 'ok' && parsedCustomLimit != null
      ? matchLimitPreset(parsedCustomLimit)
      : null;

  const canCreateInvite = useMemo(() => {
    if (isCustomExpiryExpanded && customExpiryValidation !== 'ok') {
      return false;
    }
    if (isCustomLimitExpanded && customLimitValidation !== 'ok') {
      return false;
    }
    return true;
  }, [
    isCustomExpiryExpanded,
    customExpiryValidation,
    isCustomLimitExpanded,
    customLimitValidation,
  ]);

  const limitErrorMessage = useMemo(() => {
    if (customLimitValidation === 'ok') {
      return undefined;
    }
    if (customLimitValidation === 'empty') {
      return t('room.invite.limitErrorEmpty');
    }
    if (customLimitValidation === 'nan') {
      return t('room.invite.limitErrorNaN');
    }
    if (customLimitValidation === 'not-integer') {
      return t('room.invite.limitErrorNotInteger');
    }
    if (customLimitValidation === 'below-min') {
      return t('room.invite.limitErrorBelowMin', { min: INVITE_LIMIT_MIN });
    }
    return t('room.invite.limitErrorAboveMax', { max: INVITE_LIMIT_MAX });
  }, [customLimitValidation, t]);

  const handleSelectExpiryPreset = useCallback((preset: ExpiryPreset) => {
    setExpiryPreset(preset);
    setIsCustomExpiryExpanded(false);
  }, []);

  const handleSelectCustomExpiry = useCallback(() => {
    setIsCustomExpiryExpanded(true);
    const presetSeconds = EXPIRY_PRESET_SECONDS[expiryPreset];
    setCustomExpirySeconds(presetSeconds ?? null);
  }, [expiryPreset]);

  const handleSelectLimitPreset = useCallback((preset: LimitPreset) => {
    setLimitPreset(preset);
    setIsCustomLimitExpanded(false);
  }, []);

  const handleSelectCustomLimit = useCallback(() => {
    setIsCustomLimitExpanded(true);
    const presetValue = LIMIT_PRESET_VALUES[limitPreset];
    setCustomLimitInput(presetValue != null ? String(presetValue) : '');
  }, [limitPreset]);

  const handleCustomLimitInputChange = useCallback((raw: string) => {
    setCustomLimitInput(raw.replace(/\D/g, ''));
  }, []);

  const msgTtlPresetLabelKey = (preset: MessageTtlPreset): string => {
    if (preset === 'off') return 'room.manage.msgTtlPresetOff';
    if (preset === '5m') return 'room.manage.msgTtlPreset5m';
    if (preset === '1h') return 'room.manage.msgTtlPreset1h';
    return 'room.manage.msgTtlPreset24h';
  };

  const ttlPresetLabelKey = (preset: RoomTtlPreset): string => {
    if (preset === 'none') return 'room.manage.ttlPresetNone';
    if (preset === '1h') return 'room.manage.ttlPreset1h';
    if (preset === '24h') return 'room.manage.ttlPreset24h';
    if (preset === '7d') return 'room.manage.ttlPreset7d';
    return 'room.manage.ttlPreset30d';
  };

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

  // Load bans when manage view mounts
  useEffect(() => {
    onRefreshBans?.();
  }, [onRefreshBans]);

  // Auto-fetch bans when section is expanded
  useEffect(() => {
    if (bansExpanded && onRefreshBans) {
      onRefreshBans();
    }
  }, [bansExpanded, onRefreshBans]);

  // Auto-fetch members when section is expanded (always refresh, like bans).
  // Read the callback through a ref: App.tsx passes an inline arrow whose
  // identity changes on every parent render, and keeping it in the deps caused
  // an infinite fetch loop (render -> effect -> publish -> response -> render)
  // that tripped the server GENERAL rate limit and killed the WS connection.
  const onFetchMembersRef = useRef(onFetchMembers);
  useEffect(() => { onFetchMembersRef.current = onFetchMembers; }, [onFetchMembers]);

  useEffect(() => {
    if (membersExpanded) {
      onFetchMembersRef.current();
    }
  }, [membersExpanded]);

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
    if (!onCreateInviteLink || !canCreateInvite) return;
    const options: GetInviteLinkOptions = {};

    if (isCustomExpiryExpanded) {
      if (customExpirySeconds != null) {
        options.expiresInSeconds = customExpirySeconds;
      }
    } else {
      const expiresInSeconds = EXPIRY_PRESET_SECONDS[expiryPreset];
      if (expiresInSeconds != null) {
        options.expiresInSeconds = expiresInSeconds;
      }
    }

    if (isCustomLimitExpanded) {
      if (parsedCustomLimit != null && customLimitValidation === 'ok') {
        options.maxUses = parsedCustomLimit;
      }
    } else {
      const maxUses = LIMIT_PRESET_VALUES[limitPreset];
      if (maxUses != null) {
        options.maxUses = maxUses;
      }
    }

    onCreateInviteLink(options);
  }, [
    onCreateInviteLink,
    canCreateInvite,
    isCustomExpiryExpanded,
    customExpirySeconds,
    expiryPreset,
    isCustomLimitExpanded,
    parsedCustomLimit,
    customLimitValidation,
    limitPreset,
  ]);

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
    setBanPermanently(false);
    setKickTarget({ internalId: member.internalId, displayName });
  }, [t]);

  const handleKickConfirm = useCallback(() => {
    if (kickTarget) {
      if (banPermanently && onBanMember) {
        onBanMember(kickTarget.internalId);
      } else if (onKickMember) {
        onKickMember(kickTarget.internalId);
      }
    }
    setKickTarget(null);
    setBanPermanently(false);
  }, [kickTarget, banPermanently, onBanMember, onKickMember]);

  const handleKickCancel = useCallback(() => {
    setKickTarget(null);
    setBanPermanently(false);
  }, []);

  const handleTransferClick = useCallback((member: RoomMember) => {
    const displayName = member.displayName?.trim()
      || t('room.manage.memberFallback', { id: shortInternalId(member.internalId) });
    setTransferTarget({ internalId: member.internalId, displayName });
  }, [t]);

  const handleTransferConfirm = useCallback(() => {
    if (transferTarget && onTransferOwnership) {
      onTransferOwnership(transferTarget.internalId);
    }
    setTransferTarget(null);
  }, [transferTarget, onTransferOwnership]);

  const handleTransferCancel = useCallback(() => {
    setTransferTarget(null);
  }, []);

  const canKickMember = useCallback((member: RoomMember, isYou: boolean): boolean => {
    if (!onKickMember || isYou || member.role === 'owner') return false;
    if (isOwner) return true;
    if (myRole === 'admin') return member.role === 'member';
    return false;
  }, [onKickMember, isOwner, myRole]);

  const canMuteMember = useCallback((member: RoomMember, isYou: boolean): boolean => {
    if (!onMuteMember || !onUnmuteMember || isYou || member.role === 'owner') return false;
    if (isOwner) return true;
    if (myRole === 'admin') return member.role === 'member';
    return false;
  }, [onMuteMember, onUnmuteMember, isOwner, myRole]);

  const resolveBansErrorMessage = useCallback((errorCode: string | null | undefined): string | null => {
    if (!errorCode) return null;
    const key = `room.manage.bansError.${errorCode}`;
    const message = t(key);
    return message !== key ? message : t('room.manage.bansError.unknown');
  }, [t]);

  const resolveBannedLabel = useCallback((internalId: string): string => {
    const member = members?.find(m => m.internalId === internalId);
    const displayName = member?.displayName?.trim();
    if (displayName) return displayName;
    return t('room.manage.memberFallback', { id: shortInternalId(internalId) });
  }, [members, t]);

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

  const bansErrorMessage = resolveBansErrorMessage(bansError);

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
          {onlineMemberCount > 0 && (
            <p className="room-manage-view__online-count">
              {t('room.manage.onlineCount', { count: onlineMemberCount })}
            </p>
          )}
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

        {isOwner && onApplyTtlPreset && (
          <section className="room-manage-section">
            <h3 className="room-manage-section__heading">
              <Clock size={16} aria-hidden="true" />
              {t('room.manage.ttlTitle')}
            </h3>
            <div className="room-manage-section__body room-manage-ttl">
              {autoBurnAt != null && autoBurnRemainingSec > 0 && (
                <p className="room-manage-ttl__countdown">
                  {t('room.manage.autoBurnIn', {
                    time: formatRemainingDuration(autoBurnRemainingSec),
                  })}
                </p>
              )}
              <div
                className="room-manage-ttl__presets"
                role="group"
                aria-label={t('room.manage.ttlTitle')}
              >
                {ROOM_TTL_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className={`room-manage-ttl__chip ${
                      activeTtlPreset === preset ? 'room-manage-ttl__chip--active' : ''
                    }`}
                    onClick={() => handleSelectTtlPreset(preset)}
                  >
                    {t(ttlPresetLabelKey(preset))}
                  </button>
                ))}
                {onApplyCustomTtlSeconds && (
                  <button
                    type="button"
                    className={`room-manage-ttl__chip ${
                      isCustomTtlExpanded || isCustomTtlActive
                        ? 'room-manage-ttl__chip--active'
                        : ''
                    }`}
                    onClick={handleSelectCustomTtl}
                  >
                    {t('room.manage.ttlPresetCustom')}
                  </button>
                )}
              </div>
              {onApplyCustomTtlSeconds && showCustomTtlPanel && (
                <div className="room-manage-ttl__custom">
                  <DurationField
                    id="room-manage-ttl-custom"
                    label={t('room.manage.ttlCustomLabel')}
                    valueSeconds={customTtlSeconds}
                    onChange={setCustomTtlSeconds}
                    minSeconds={ROOM_TTL_CUSTOM_MIN_SECONDS}
                    maxSeconds={ROOM_TTL_CUSTOM_MAX_SECONDS}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleApplyCustomTtl}
                    disabled={!canApplyCustomTtl}
                  >
                    {t('room.manage.ttlCustomApply')}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}

        {isOwner && onApplyMessageTtlPreset && (
          <section className="room-manage-section">
            <h3 className="room-manage-section__heading">
              <Timer size={16} aria-hidden="true" />
              {t('room.manage.msgTtlTitle')}
            </h3>
            <div className="room-manage-section__body room-manage-msg-ttl">
              <div
                className="room-manage-msg-ttl__presets"
                role="group"
                aria-label={t('room.manage.msgTtlTitle')}
              >
                {MESSAGE_TTL_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className={`room-manage-msg-ttl__chip ${
                      activeMessageTtlPreset === preset ? 'room-manage-msg-ttl__chip--active' : ''
                    }`}
                    onClick={() => handleSelectMessageTtlPreset(preset)}
                  >
                    {t(msgTtlPresetLabelKey(preset))}
                  </button>
                ))}
                {onApplyCustomMessageTtlSeconds && (
                  <button
                    type="button"
                    className={`room-manage-msg-ttl__chip ${
                      isCustomMsgTtlExpanded || isCustomMsgTtlActive
                        ? 'room-manage-msg-ttl__chip--active'
                        : ''
                    }`}
                    onClick={handleSelectCustomMsgTtl}
                  >
                    {t('room.manage.msgTtlPresetCustom')}
                  </button>
                )}
              </div>
              {onApplyCustomMessageTtlSeconds && showCustomMsgTtlPanel && (
                <div className="room-manage-msg-ttl__custom">
                  <DurationField
                    id="room-manage-msg-ttl-custom"
                    label={t('room.manage.msgTtlCustomLabel')}
                    valueSeconds={customMsgTtlSeconds}
                    onChange={setCustomMsgTtlSeconds}
                    minSeconds={MESSAGE_TTL_CUSTOM_MIN_SECONDS}
                    maxSeconds={MESSAGE_TTL_CUSTOM_MAX_SECONDS}
                    units={['minute', 'hour']}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleApplyCustomMsgTtl}
                    disabled={!canApplyCustomMsgTtl}
                  >
                    {t('room.manage.msgTtlCustomApply')}
                  </Button>
                </div>
              )}
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
                      roomTitle={
                        displayTitle === formatShortRoomId(roomId) ? null : displayTitle
                      }
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
                        className={`room-manage-invites-create__chip ${
                          (isCustomExpiryExpanded ? matchedExpiryPreset === key : expiryPreset === key)
                            ? 'room-manage-invites-create__chip--active'
                            : ''
                        }`}
                        onClick={() => handleSelectExpiryPreset(key)}
                      >
                        {t(`room.invite.createExpiry${key === 'none' ? 'None' : key}`)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`room-manage-invites-create__chip ${
                        isCustomExpiryExpanded && matchedExpiryPreset === null
                          ? 'room-manage-invites-create__chip--active'
                          : ''
                      }`}
                      onClick={handleSelectCustomExpiry}
                    >
                      {t('room.invite.createExpiryCustom')}
                    </button>
                  </div>
                  {isCustomExpiryExpanded && (
                    <div className="room-manage-invites-create__custom">
                      <DurationField
                        id="room-manage-invite-expiry-custom"
                        label={t('room.invite.expiryCustomLabel')}
                        valueSeconds={customExpirySeconds}
                        onChange={setCustomExpirySeconds}
                        minSeconds={INVITE_EXPIRY_MIN_SECONDS}
                        maxSeconds={INVITE_EXPIRY_MAX_SECONDS}
                      />
                    </div>
                  )}
                </div>
                <div className="room-manage-invites-create__group">
                  <span className="room-manage-invites-create__label">{t('room.invite.createLimitLabel')}</span>
                  <div className="room-manage-invites-create__presets" role="group" aria-label={t('room.invite.createLimitLabel')}>
                    {(['1', '5', '10', 'unlimited'] as LimitPreset[]).map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`room-manage-invites-create__chip ${
                          (isCustomLimitExpanded ? matchedLimitPreset === key : limitPreset === key)
                            ? 'room-manage-invites-create__chip--active'
                            : ''
                        }`}
                        onClick={() => handleSelectLimitPreset(key)}
                      >
                        {t(`room.invite.createLimit${key === 'unlimited' ? 'Unlimited' : key}`)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`room-manage-invites-create__chip ${
                        isCustomLimitExpanded && matchedLimitPreset === null
                          ? 'room-manage-invites-create__chip--active'
                          : ''
                      }`}
                      onClick={handleSelectCustomLimit}
                    >
                      {t('room.invite.createLimitCustom')}
                    </button>
                  </div>
                  {isCustomLimitExpanded && (
                    <div className="room-manage-invites-create__custom">
                      <Input
                        id="room-manage-invite-limit-custom"
                        type="text"
                        inputMode="numeric"
                        label={t('room.invite.limitCustomLabel')}
                        value={customLimitInput}
                        onChange={(e) => handleCustomLimitInputChange(e.target.value)}
                        error={limitErrorMessage}
                        autoComplete="off"
                      />
                    </div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  onClick={handleCreateInvite}
                  disabled={isCreateInviteLoading || !canCreateInvite}
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

        {/* ── Join requests (owner-only) ───────────────── */}
        {isOwner && (
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
        )}

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
                    const canKick = canKickMember(member, isYou);
                    const isMuted = mutedInternalIds.includes(member.internalId);
                    const canMute = canMuteMember(member, isYou);
                    const canPromote = isOwner
                      && onSetMemberRole != null
                      && member.role === 'member'
                      && !isYou;
                    const canDemote = isOwner
                      && onSetMemberRole != null
                      && member.role === 'admin';
                    const canTransfer = isOwner
                      && onTransferOwnership != null
                      && member.role !== 'owner'
                      && !isYou;
                    const hasActions = canKick || canMute || canPromote || canDemote || canTransfer;

                    return (
                      <RoomMemberRow
                        key={member.internalId}
                        member={member}
                        isYou={isYou}
                        presence={memberPresence?.get(member.internalId)}
                        presenceTick={presenceTick}
                        actions={
                          hasActions ? (
                            <div className="room-member-row__action-group">
                              {canPromote && (
                                <button
                                  type="button"
                                  className="room-member-row__role-btn"
                                  onClick={() => onSetMemberRole!(member.internalId, 'admin')}
                                  aria-label={t('room.manage.promoteAdmin', {
                                    name: member.displayName?.trim() || member.internalId,
                                  })}
                                >
                                  <Shield size={16} aria-hidden="true" />
                                  <span className="room-member-row__role-label">
                                    {t('room.manage.promoteAdmin')}
                                  </span>
                                </button>
                              )}
                              {canDemote && (
                                <button
                                  type="button"
                                  className="room-member-row__role-btn"
                                  onClick={() => onSetMemberRole!(member.internalId, 'member')}
                                  aria-label={t('room.manage.demoteAdmin', {
                                    name: member.displayName?.trim() || member.internalId,
                                  })}
                                >
                                  <ShieldMinus size={16} aria-hidden="true" />
                                  <span className="room-member-row__role-label">
                                    {t('room.manage.demoteAdmin')}
                                  </span>
                                </button>
                              )}
                              {canTransfer && (
                                <button
                                  type="button"
                                  className="room-member-row__role-btn room-member-row__role-btn--transfer"
                                  onClick={() => handleTransferClick(member)}
                                  aria-label={t('room.manage.transferOwnership', {
                                    name: member.displayName?.trim() || member.internalId,
                                  })}
                                >
                                  <Crown size={16} aria-hidden="true" />
                                  <span className="room-member-row__role-label">
                                    {t('room.manage.transferOwnership')}
                                  </span>
                                </button>
                              )}
                              {canMute && (
                                <button
                                  type="button"
                                  className={`room-member-row__mute-btn${isMuted ? ' room-member-row__mute-btn--active' : ''}`}
                                  onClick={() => (
                                    isMuted
                                      ? onUnmuteMember!(member.internalId)
                                      : onMuteMember!(member.internalId)
                                  )}
                                  aria-label={
                                    isMuted
                                      ? t('room.manage.unmuteButton', {
                                        name: member.displayName?.trim() || member.internalId,
                                      })
                                      : t('room.manage.muteButton', {
                                        name: member.displayName?.trim() || member.internalId,
                                      })
                                  }
                                >
                                  {isMuted ? (
                                    <Volume2 size={16} aria-hidden="true" />
                                  ) : (
                                    <MicOff size={16} aria-hidden="true" />
                                  )}
                                  <span className="room-member-row__mute-label">
                                    {isMuted
                                      ? t('room.manage.unmuteButton')
                                      : t('room.manage.muteButton')}
                                  </span>
                                </button>
                              )}
                              {canKick && (
                                <button
                                  type="button"
                                  className="room-member-row__kick-btn"
                                  onClick={() => handleKickClick(member)}
                                  aria-label={t('room.manage.kickButton', { name: member.displayName?.trim() || member.internalId })}
                                >
                                  <UserMinus size={16} aria-hidden="true" />
                                  <span className="room-member-row__kick-label">{t('room.manage.kickButton')}</span>
                                </button>
                              )}
                            </div>
                          ) : undefined
                        }
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

        {/* ── Banned users (owner-only) ────────────────── */}
        {isOwner && onRefreshBans != null && (
          <section className="room-manage-section">
            <button
              type="button"
              className="room-manage-nav-item"
              onClick={() => setBansExpanded(v => !v)}
            >
              <span className="room-manage-nav-item__label">
                <ShieldBan size={18} aria-hidden="true" />
                {t('room.manage.bannedTitle')}
              </span>
              {bannedInternalIds.length > 0 && (
                <span className="room-manage-nav-item__badge">{bannedInternalIds.length}</span>
              )}
              <ChevronRight
                size={18}
                className={`room-manage-nav-item__arrow ${bansExpanded ? 'room-manage-nav-item__arrow--open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {bansExpanded && (
              <div className="room-manage-banned">
                {isBansLoading ? (
                  <p className="room-manage-banned__loading">{t('common.loading')}</p>
                ) : bansErrorMessage ? (
                  <p className="room-manage-section__error" role="alert">
                    {bansErrorMessage}
                  </p>
                ) : bannedInternalIds.length > 0 ? (
                  <ul className="room-manage-banned__list">
                    {bannedInternalIds.map(internalId => (
                      <li key={internalId} className="room-manage-banned-row">
                        <div className="room-manage-banned-row__info">
                          <span className="room-manage-banned-row__name">
                            {resolveBannedLabel(internalId)}
                          </span>
                          <span className="room-manage-banned-row__id">{internalId}</span>
                        </div>
                        {onUnban != null && (
                          <button
                            type="button"
                            className="room-manage-banned-row__unban-btn"
                            onClick={() => onUnban(internalId)}
                          >
                            {t('room.manage.unbanButton')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="room-manage-banned__empty">{t('room.manage.bannedEmpty')}</p>
                )}
              </div>
            )}
          </section>
        )}

        {isModerator && onSetReadOnly != null && (
          <section className="room-manage-section">
            <div className="room-manage-readonly">
              <div className="room-manage-readonly__info">
                <h3 className="room-manage-section__heading room-manage-readonly__heading">
                  <MicOff size={16} aria-hidden="true" />
                  {t('room.manage.readOnlyToggle')}
                </h3>
                <p className="room-manage-readonly__hint">
                  {t(isOwner ? 'room.manage.readOnlyHint' : 'room.manage.readOnlyHintModerator')}
                </p>
              </div>
              <label className="room-manage-readonly__switch">
                <input
                  type="checkbox"
                  checked={roomReadOnly}
                  onChange={(e) => onSetReadOnly(e.target.checked)}
                  aria-label={t('room.manage.readOnlyToggle')}
                />
                <span className="room-manage-readonly__slider" aria-hidden="true" />
              </label>
            </div>
          </section>
        )}

        {/* ── Burn room (owner-only) ───────────────────── */}
        {isOwner && (
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
        )}
      </div>

      {kickTarget && (
        <div className="room-manage-kick-dialog-overlay" role="dialog" aria-modal="true">
          <div className="room-manage-kick-dialog">
            <div className="room-manage-kick-dialog__icon" aria-hidden="true">
              <UserMinus size={40} strokeWidth={1.5} />
            </div>
            <h3 className="room-manage-kick-dialog__title">
              {t('room.manage.kickConfirmTitle', { name: kickTarget.displayName })}
            </h3>
            <p className="room-manage-kick-dialog__text">
              {t('room.manage.kickConfirmDescription')}
            </p>
            <p className="room-manage-kick-dialog__warning">
              {t('room.manage.kickConfirmWarning')}
            </p>
            {onBanMember != null && (
              <label className="room-manage-kick-dialog__ban-option">
                <input
                  type="checkbox"
                  checked={banPermanently}
                  onChange={(e) => setBanPermanently(e.target.checked)}
                />
                <span>{t('room.manage.banOption')}</span>
              </label>
            )}
            <div className="room-manage-kick-dialog__actions">
              <Button variant="secondary" onClick={handleKickCancel} fullWidth>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleKickConfirm}
                fullWidth
              >
                {banPermanently
                  ? t('room.manage.banConfirmButton')
                  : t('room.manage.kickConfirmButton')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={transferTarget != null}
        onClose={handleTransferCancel}
        onConfirm={handleTransferConfirm}
        title={t('room.manage.transferConfirmTitle', {
          name: transferTarget?.displayName ?? '',
        })}
        description={t('room.manage.transferConfirmDescription')}
        warning={t('room.manage.transferConfirmWarning')}
        confirmLabel={t('room.manage.transferConfirmButton')}
        variant="destructive"
      />

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
