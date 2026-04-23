import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './EditChip.css';

export interface EditChipProps {
  onCancel: () => void;
  labelKey?: string;
}

export function EditChip({ onCancel, labelKey = 'chat.edit.editChipLabel' }: EditChipProps) {
  const { t } = useTranslation();
  return (
    <div className="edit-chip" role="status" aria-live="polite" data-testid="edit-chip">
      <span className="edit-chip__text">{t(labelKey)}</span>
      <button
        type="button"
        className="edit-chip__close"
        onClick={onCancel}
        aria-label={t('chat.edit.cancel')}
      >
        <X size={16} />
      </button>
    </div>
  );
}
