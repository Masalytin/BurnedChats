/**
 * Common types for BurnedChats frontend
 */

// ============================================
// User & Search Types
// ============================================

export interface UserInfo {
  /** Stable address id (UUID). Primary key for DM/room routing. */
  internalId: string;
  /** Telegram numeric ID when available (wallet-only users omit). */
  id?: number;
  username?: string;
  displayName: string;
  /** Normalized wallet address when known (search / display). */
  walletAddress?: string;
  photoUrl?: string;
  online: boolean;
  premium: boolean;
}

/** Wire shape of backend {@code UserResponse} in STOMP events. */
export interface WireUserResponse {
  internalId?: string | null;
  id?: number | null;
  username?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  walletAddress?: string | null;
  online?: boolean;
  premium?: boolean;
}

/** Maps backend UserResponse to frontend UserInfo. */
export function mapWireUser(raw: WireUserResponse): UserInfo {
  const internalId = raw.internalId?.trim()
    || (raw.id != null ? String(raw.id) : '');
  if (!internalId) {
    throw new Error('Wire user payload missing internalId');
  }
  return {
    internalId,
    id: raw.id ?? undefined,
    username: raw.username ?? undefined,
    displayName: raw.displayName?.trim() || (raw.id != null ? `User ${raw.id}` : 'User'),
    walletAddress: raw.walletAddress ?? undefined,
    photoUrl: raw.photoUrl ?? undefined,
    online: Boolean(raw.online),
    premium: Boolean(raw.premium),
  };
}

export type SearchStatus = 
  | 'idle'        // No search in progress
  | 'searching'   // Search request sent
  | 'found'       // User found
  | 'not_found'   // User not found
  | 'error';      // Search error

export type SearchErrorCode = 
  | 'SELF_SEARCH'    // User tried to search for themselves
  | 'INVALID_QUERY'  // Query format is invalid
  | 'RATE_LIMITED'   // Too many search requests
  | 'CONNECTION_ERROR'; // WebSocket not connected

export interface SearchResult {
  status: SearchStatus;
  user: UserInfo | null;
  error: SearchErrorCode | null;
}

// ============================================
// Session & Chat Types
// ============================================

export type SessionStatus = 
  | 'pending'       // Request sent, waiting for response
  | 'handshaking'   // Key exchange in progress
  | 'active'        // Chat is active
  | 'expired'       // Session has expired
  | 'burned';       // Session was destroyed

export interface Session {
  id: string;
  peerInternalId: string;
  /** @deprecated Prefer peerInternalId */
  peerId?: number;
  peerUsername?: string;
  peerName: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt?: number;
  hasUnread?: boolean;
}

export interface ChatRequest {
  id: string;
  fromInternalId: string;
  /** @deprecated Prefer fromInternalId */
  fromUserId?: number;
  fromUsername?: string;
  fromName: string;
  secretQuestion?: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================
// Message Types
// ============================================

export type MessageType = 'text' | 'image' | 'video' | 'file';

/** Hydrated quote for display; preview is always client-side (never from server). */
export interface ReplyToInfo {
  messageId: string;
  senderId: number;
  senderName?: string;
  preview: string;
  type: MessageType;
  /** True when the referenced id is not in the local message list. */
  deleted?: boolean;
}

export type MessageStatus = 
  | 'sending'    // Message is being sent
  | 'sent'       // Message sent to server
  | 'delivered'  // Message delivered to peer
  | 'read'       // Message read by peer
  | 'failed';    // Message failed to send

export interface Message {
  id: string;
  sessionId: string;
  /** Telegram sender id when present on the wire (wallet senders may omit). */
  fromUserId?: number;
  encryptedContent: string;    // Base64 encoded
  iv: string;                  // Base64 encoded initialization vector
  timestamp: number;
  status: MessageStatus;
  type: MessageType;
  /** Plaintext relay metadata: id of the message this one replies to. */
  replyToMessageId?: string;

  // File-specific fields (present when type !== 'text')
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;      // Base64: encrypted {fileName, mimeType}
  fileSize?: number;           // Original plaintext file size in bytes (STOMP / UI)
}

export interface DecryptedMessage extends Omit<Message, 'encryptedContent' | 'iv' | 'encryptedMeta'> {
  content: string;
  isOwn: boolean;
  /** Display name of the sender — set for room messages only; undefined for 1-to-1 chats. */
  senderName?: string;
  /** Client-only quote hydrated from `replyToMessageId` and local state. */
  replyTo?: ReplyToInfo;
  /** When set, the message was edited (UI shows an “edited” label). */
  editedAt?: number;
}

/**
 * Decrypted file metadata extracted from encryptedMeta.
 */
export interface FileMetadata {
  fileName: string;
  mimeType: string;
}

/**
 * Extended decrypted message for file types (image, video, file).
 * Contains resolved file metadata after client-side decryption.
 */
export interface DecryptedFileMessage extends DecryptedMessage {
  type: 'image' | 'video' | 'file';
  fileId: string;
  fileSize: number;            // Original plaintext file size in bytes (not ciphertext)
  fileMeta: FileMetadata;
  thumbnailFileId?: string;
  thumbnailUrl?: string;
  /**
   * Transient client-only upload progress (0–100) for an own in-flight file
   * message. Set while `status === 'sending'` and the encrypt/upload pipeline
   * is running; cleared once the file is uploaded. Never sent on the wire.
   */
  uploadProgress?: number;
  /**
   * Transient client-only upload stage for an own in-flight file message.
   * Mirrors {@link UploadStage} ('encrypting' | 'uploading'). Never on the wire.
   */
  uploadStage?: 'encrypting' | 'uploading';
  /**
   * Client-only group-key epoch that decrypted this file message.
   * Set during feed decrypt so bubbles/viewer reuse the same epoch for
   * thumbnail and full-file download. Never sent on the wire.
   */
  keyEpoch?: number;
}

// ============================================
// DM sync (IMP-MA-07) — /user/queue/sync-messages
// ============================================

/** Tombstone edit delivered with offline sync (ciphertext; decrypt with session key). */
export interface SyncedEdit {
  messageId: string;
  encryptedContent: string;
  iv: string;
  /** Server time as epoch ms or ISO-8601 (Jackson Instant). */
  editedAt: number | string;
}

/** Full drain of pending DM data after reconnect. */
export interface DmSyncMessagesEvent {
  success: boolean;
  sessionId: string;
  /** Pending offline message payloads. */
  messages: unknown[];
  count: number;
  serverTimestamp: string;
  error?: string;
  deletedIds?: string[];
  /** @deprecated Prefer deletedIds. */
  deletedMessageIds?: string[];
  edits?: SyncedEdit[];
}

// ============================================
// WebSocket Event Types
// ============================================

export type WebSocketEventType =
  | 'INCOMING_REQUEST'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_EXPIRED'
  | 'PEER_PUBLIC_KEY'
  | 'HANDSHAKE_COMPLETE'
  | 'NEW_MESSAGE'
  | 'MESSAGE_DELIVERED'
  | 'MESSAGE_READ'
  | 'TYPING_START'
  | 'TYPING_STOP'
  | 'BURN_SIGNAL'
  | 'SESSION_EXPIRED'
  | 'PEER_OFFLINE'
  | 'PEER_ONLINE'
  | 'ERROR';

export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  sessionId?: string;
  payload: T;
  timestamp: number;
}

// ============================================
// Crypto Types
// ============================================

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface ExportedKeyPair {
  publicKey: string;    // Base64 encoded
  privateKey: string;   // Base64 encoded (for backup only)
}

export interface SharedSecret {
  sessionId: string;
  key: CryptoKey;
  fingerprint: string;  // 8-char hex fingerprint
  visualFingerprint: VisualFingerprintElement[];  // Visual verification shapes
}

// ============================================
// Visual Fingerprint Types
// ============================================

/**
 * Single element of a visual fingerprint.
 *
 * Alphabet v1 (emoji): the fingerprint is a sequence of emoji slots derived
 * deterministically from SHA-256(sort(pubA, pubB)). The `color` field was
 * removed in IMP-FPEMOJI-01 — multicolor emoji glyphs make a CSS `color`
 * channel invisible/unverifiable, so entropy is carried by the emoji choice
 * alone (see docs/specs/SECURITY.md — visual fingerprint).
 */
export interface VisualFingerprintElement {
  emoji: string;
}

// ============================================
// UI State Types
// ============================================

// ============================================
// Room Types (Phase 2)
// ============================================

export type RoomJoinMode = 'BY_PASSWORD' | 'BY_REQUEST';

export interface Room {
  id: string;
  /** Stable owner id (primary). */
  ownerInternalId?: string;
  /** @deprecated Prefer {@link ownerInternalId}. Present for Telegram-linked owners. */
  ownerTgId?: number;
  joinMode?: RoomJoinMode;
  createdAt?: number;
  nameEncrypted?: string;
  nameIv?: string;
}

/**
 * Encrypted group key bundle sent from owner to a new room member.
 * The server relays this opaque blob — it cannot decrypt the group key.
 *
 * Reference: docs/specs/GROUP_KEY_PROTOCOL.md
 */
export interface KeyBundle {
  roomId: string;
  epoch: number;
  /** Internal ID of the intended recipient (local wrap metadata; not on wire KEY_BUNDLE event). */
  recipientInternalId: string;
  /** Base64-encoded ephemeral ECDH P-256 public key (65 bytes, uncompressed). */
  ephemeralPublicKey: string;
  /** Base64-encoded AES-256-GCM ciphertext of the group key (32 bytes + 16-byte tag). */
  encryptedKey: string;
  /** Base64-encoded 12-byte AES-GCM IV. */
  iv: string;
}

/** Pending join request visible to the room owner. */
export interface RoomJoinRequest {
  roomId: string;
  senderInternalId: string;
  senderUsername: string | null;
  senderFirstName: string;
  requestedAt: number;
}

/** Room role in list / membership context (owner, co-admin overlay, or member). */
export type RoomRole = 'owner' | 'admin' | 'member';

/** Single room entry returned by GET_MY_ROOMS / ROOM_LIST. */
export interface RoomListEntry {
  roomId: string;
  role: RoomRole;
  createdAt: number;
  nameEncrypted?: string | null;
  nameIv?: string | null;
}

/** Room member row returned by GET_ROOM_MEMBERS / RoomMembersListEvent. */
export type RoomMemberRole = RoomRole;

export interface RoomMember {
  internalId: string;
  displayName?: string | null;
  username?: string | null;
  role: RoomMemberRole;
  joinedAt?: number | null;
}

// ============================================
// View Types
// ============================================

export type ViewType = 
  | 'home'
  | 'search'
  | 'incoming-request'
  | 'outgoing-request'
  | 'handshake'
  | 'verification'
  | 'chat';

export interface AppState {
  currentView: ViewType;
  activeSessionId: string | null;
  sessions: Session[];
  incomingRequests: ChatRequest[];
  isLoading: boolean;
  error: string | null;
}


