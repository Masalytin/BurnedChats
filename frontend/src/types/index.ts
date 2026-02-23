/**
 * Common types for BurnedChats frontend
 */

// ============================================
// User & Search Types
// ============================================

export interface UserInfo {
  id: number;
  username?: string;
  displayName: string;
  photoUrl?: string;
  online: boolean;
  premium: boolean;
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
  peerId: number;
  peerUsername?: string;
  peerName: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt?: number;
  hasUnread?: boolean;
}

export interface ChatRequest {
  id: string;
  fromUserId: number;
  fromUsername?: string;
  fromName: string;
  secretQuestion?: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================
// Message Types
// ============================================

export type MessageStatus = 
  | 'sending'    // Message is being sent
  | 'sent'       // Message sent to server
  | 'delivered'  // Message delivered to peer
  | 'read'       // Message read by peer
  | 'failed';    // Message failed to send

export interface Message {
  id: string;
  sessionId: string;
  fromUserId: number;
  encryptedContent: string;    // Base64 encoded
  iv: string;                  // Base64 encoded initialization vector
  timestamp: number;
  status: MessageStatus;
}

export interface DecryptedMessage extends Omit<Message, 'encryptedContent' | 'iv'> {
  content: string;
  isOwn: boolean;
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

/** Available shapes for visual fingerprint */
export type FingerprintShape = '◆' | '○' | '□' | '△' | '⬡' | '⬢';

/** Available colors for visual fingerprint */
export type FingerprintColor = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'cyan';

/** Single element of a visual fingerprint (shape + color) */
export interface VisualFingerprintElement {
  shape: FingerprintShape;
  color: FingerprintColor;
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
  ownerTgId?: number;
  joinMode?: RoomJoinMode;
  createdAt?: number;
  nameEncrypted?: string;
}

/** Pending join request visible to the room owner. */
export interface RoomJoinRequest {
  roomId: string;
  senderTgId: number;
  senderUsername: string | null;
  senderFirstName: string;
  requestedAt: number;
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


