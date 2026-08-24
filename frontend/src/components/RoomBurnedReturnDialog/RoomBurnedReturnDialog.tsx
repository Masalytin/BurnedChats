import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import './RoomBurnedReturnDialog.css';

export interface RoomBurnedReturnDialogProps {
  count: number;
  onDismiss: () => void;
}

export function RoomBurnedReturnDialog({ count, onDismiss }: RoomBurnedReturnDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="room-burned-return"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-burned-return-title"
    >
      <div className="room-burned-return__card">
        <h2 id="room-burned-return-title" className="room-burned-return__title">
          {t('room.burnedReturnTitle')}
        </h2>
        <p className="room-burned-return__text">{t('room.burnedReturnBody', { count })}</p>
        <div className="room-burned-return__actions">
          <Button type="button" variant="primary" fullWidth onClick={onDismiss}>
            {t('room.burnedReturnCta')}
          </Button>
        </div>
      </div>
    </div>
  );
}
