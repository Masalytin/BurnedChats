import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import type { RoomJoinRequest } from '../../types';
import './RoomJoinRequestsView.css';

interface RoomJoinRequestCardProps {
  request: RoomJoinRequest;
  onAccept: (roomId: string, senderTgId: number) => void;
  onReject: (roomId: string, senderTgId: number) => void;
  isProcessing?: boolean;
}

function RoomJoinRequestCard({
  request,
  onAccept,
  onReject,
  isProcessing = false,
}: RoomJoinRequestCardProps) {
  const { t } = useTranslation();

  const displayName = request.senderUsername
    ? `@${request.senderUsername}`
    : request.senderFirstName;

  const formattedTime = new Date(request.requestedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="room-join-request-card">
      <div className="room-join-request-card__info">
        <span className="room-join-request-card__name">{displayName}</span>
        <span className="room-join-request-card__time">{formattedTime}</span>
      </div>
      <div className="room-join-request-card__actions">
        <Button
          variant="primary"
          onClick={() => onAccept(request.roomId, request.senderTgId)}
          disabled={isProcessing}
          className="room-join-request-card__btn room-join-request-card__btn--accept"
        >
          {t('room.requests.acceptButton')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => onReject(request.roomId, request.senderTgId)}
          disabled={isProcessing}
          className="room-join-request-card__btn room-join-request-card__btn--reject"
        >
          {t('room.requests.rejectButton')}
        </Button>
      </div>
    </div>
  );
}

interface RoomJoinRequestsViewProps {
  /** All pending join requests for the owner. */
  requests: RoomJoinRequest[];
  /** Set of `${roomId}:${senderTgId}` keys currently being processed. */
  processingKeys?: Set<string>;
  /** Called when the owner accepts a request. */
  onAccept: (roomId: string, senderTgId: number) => void;
  /** Called when the owner rejects a request. */
  onReject: (roomId: string, senderTgId: number) => void;
  /** Called when the owner navigates back. */
  onBack?: () => void;
}

/**
 * Screen for the room owner showing pending join requests.
 *
 * Features:
 * - Real-time list of pending requests (updated as new ones arrive).
 * - Accept / Reject buttons per request.
 * - Empty state when there are no pending requests.
 *
 * All strings via react-i18next (`room.requests.*`).
 */
export function RoomJoinRequestsView({
  requests,
  processingKeys,
  onAccept,
  onReject,
  onBack,
}: RoomJoinRequestsViewProps) {
  const { t } = useTranslation();

  const handleAccept = useCallback(
    (roomId: string, senderTgId: number) => {
      onAccept(roomId, senderTgId);
    },
    [onAccept]
  );

  const handleReject = useCallback(
    (roomId: string, senderTgId: number) => {
      onReject(roomId, senderTgId);
    },
    [onReject]
  );

  return (
    <div className="room-join-requests-view">
      <div className="room-join-requests-view__header">
        <h2 className="room-join-requests-view__title">
          {t('room.requests.title')}
          {requests.length > 0 && (
            <span className="room-join-requests-view__badge">{requests.length}</span>
          )}
        </h2>
      </div>

      <div className="room-join-requests-view__list">
        {requests.length === 0 ? (
          <div className="room-join-requests-view__empty">
            <div className="room-join-requests-view__empty-icon" aria-hidden="true">📭</div>
            <p className="room-join-requests-view__empty-text">{t('room.requests.empty')}</p>
          </div>
        ) : (
          requests.map(request => (
            <RoomJoinRequestCard
              key={`${request.roomId}:${request.senderTgId}`}
              request={request}
              onAccept={handleAccept}
              onReject={handleReject}
              isProcessing={processingKeys?.has(`${request.roomId}:${request.senderTgId}`)}
            />
          ))
        )}
      </div>

      {onBack && (
        <div className="room-join-requests-view__footer">
          <Button variant="secondary" onClick={onBack} fullWidth>
            {t('common.back')}
          </Button>
        </div>
      )}
    </div>
  );
}
