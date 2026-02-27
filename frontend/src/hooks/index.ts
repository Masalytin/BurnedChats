export { useTelegram } from './useTelegram';
export type { TelegramUser, TelegramChat } from './useTelegram';
export { useWebSocket } from './useWebSocket';
export type { WebSocketErrorType } from './useWebSocket';
export { useSearch } from './useSearch';
export { useSession } from './useSession';
export type { SessionErrorCode, CreateSessionStatus, CreateSessionResult, PendingSession } from './useSession';
export { useIncomingRequests } from './useIncomingRequests';
export type { AcceptErrorCode, ActionStatus, ActionResult } from './useIncomingRequests';
export { useHandshake } from './useHandshake';
export type { HandshakeStage, HandshakeErrorCode, HandshakeResult } from './useHandshake';
export { useVerification } from './useVerification';
export type { VerificationErrorCode, VerificationStatus } from './useVerification';
export { useMessages } from './useMessages';
export type { MessageErrorCode, SendMessageResult } from './useMessages';
export { useRoomMessages } from './useRoomMessages';
export type { RoomMessageErrorCode, SendRoomMessageResult, UseRoomMessagesWebSocket } from './useRoomMessages';
export { useBurn } from './useBurn';
export type { BurnErrorCode, BurnStatus } from './useBurn';

// UX hooks (Sprint 4.5)
export { useHaptics } from './useHaptics';
export type { ImpactStyle, NotificationType } from './useHaptics';
export { useBackButton, useAutoBackButton } from './useBackButton';

// Lifecycle hooks (Sprint 5.1)
export { useAppLifecycle } from './useAppLifecycle';

// Active Sessions hooks (Sprint 4.6)
export { useActiveSessions } from './useActiveSessions';
export type { 
  SessionStatus as ActiveSessionStatus,
  PeerInfo, 
  ActiveSession, 
  ActiveSessionsErrorCode,
  ResumeSessionErrorCode,
  ResumeSessionResult,
} from './useActiveSessions';
