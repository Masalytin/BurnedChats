import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Timer, X } from 'lucide-react';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { DurationField } from '@/components/DurationField';
import {
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_PRESETS,
  matchMessageTtlPreset,
  type MessageTtlPreset,
} from '@/utils/messageTtlPresets';
import { validateDurationSeconds } from '@/utils/duration';
import './DmMessageTtlSheet.css';

export interface DmMessageTtlSheetProps {
  open: boolean;
  onClose: () => void;
  messageTtlSeconds: number;
  onApplyPreset: (preset: MessageTtlPreset) => void;
  onApplyCustomSeconds: (seconds: number) => void;
}

function msgTtlPresetLabelKey(preset: MessageTtlPreset): string {
  if (preset === 'off') return 'room.manage.msgTtlPresetOff';
  if (preset === '5m') return 'room.manage.msgTtlPreset5m';
  if (preset === '1h') return 'room.manage.msgTtlPreset1h';
  return 'room.manage.msgTtlPreset24h';
}

/**
 * DM message-TTL presets + custom (UX copy of RoomManageView msgTtl, no owner).
 */
export function DmMessageTtlSheet({
  open,
  onClose,
  messageTtlSeconds,
  onApplyPreset,
  onApplyCustomSeconds,
}: DmMessageTtlSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [isCustomExpanded, setIsCustomExpanded] = useState(false);
  const [customSeconds, setCustomSeconds] = useState<number | null>(null);

  const activePreset = matchMessageTtlPreset(messageTtlSeconds);
  const isCustomActive = activePreset === null && messageTtlSeconds > 0;
  const showCustomPanel = isCustomExpanded || isCustomActive;
  const customValidation = validateDurationSeconds(customSeconds, {
    min: MESSAGE_TTL_CUSTOM_MIN_SECONDS,
    max: MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  });
  const canApplyCustom = customValidation === 'ok' && customSeconds != null;

  useEffect(() => {
    if (activePreset !== null) {
      setIsCustomExpanded(false);
      return;
    }
    if (messageTtlSeconds > 0) {
      setIsCustomExpanded(true);
      setCustomSeconds(messageTtlSeconds);
    }
  }, [activePreset, messageTtlSeconds]);

  const handleSelectPreset = useCallback((preset: MessageTtlPreset) => {
    setIsCustomExpanded(false);
    onApplyPreset(preset);
  }, [onApplyPreset]);

  const handleSelectCustom = useCallback(() => {
    setIsCustomExpanded(true);
    if (messageTtlSeconds > 0 && activePreset === null) {
      setCustomSeconds(messageTtlSeconds);
    } else {
      setCustomSeconds(null);
    }
  }, [messageTtlSeconds, activePreset]);

  const handleApplyCustom = useCallback(() => {
    if (!canApplyCustom || customSeconds == null) {
      return;
    }
    onApplyCustomSeconds(customSeconds);
  }, [canApplyCustom, customSeconds, onApplyCustomSeconds]);

  if (!open) {
    return null;
  }

  return createPortal(
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      reducedMotionAware
      initialFocusRef={closeBtnRef}
      backdropClassName="dm-msg-ttl-sheet-backdrop"
      panelClassName="dm-msg-ttl-sheet-panel"
    >
      <header className="dm-msg-ttl-sheet-header">
        <h2 id={titleId} className="dm-msg-ttl-sheet-title">
          <Timer size={16} aria-hidden="true" />
          {t('room.manage.msgTtlTitle')}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="dm-msg-ttl-sheet-close"
          onClick={onClose}
          aria-label={t('aria.closeDialog')}
        >
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
      </header>
      <div className="dm-msg-ttl-sheet-body">
        <div
          className="dm-msg-ttl-sheet-presets"
          role="group"
          aria-label={t('room.manage.msgTtlTitle')}
        >
          {MESSAGE_TTL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`dm-msg-ttl-sheet-chip${
                activePreset === preset ? ' dm-msg-ttl-sheet-chip--active' : ''
              }`}
              onClick={() => handleSelectPreset(preset)}
            >
              {t(msgTtlPresetLabelKey(preset))}
            </button>
          ))}
          <button
            type="button"
            className={`dm-msg-ttl-sheet-chip${
              isCustomExpanded || isCustomActive ? ' dm-msg-ttl-sheet-chip--active' : ''
            }`}
            onClick={handleSelectCustom}
          >
            {t('room.manage.msgTtlPresetCustom')}
          </button>
        </div>
        {showCustomPanel && (
          <div className="dm-msg-ttl-sheet-custom">
            <DurationField
              id="dm-msg-ttl-custom"
              label={t('room.manage.msgTtlCustomLabel')}
              valueSeconds={customSeconds}
              onChange={setCustomSeconds}
              minSeconds={MESSAGE_TTL_CUSTOM_MIN_SECONDS}
              maxSeconds={MESSAGE_TTL_CUSTOM_MAX_SECONDS}
              units={['minute', 'hour']}
            />
            <Button
              variant="secondary"
              onClick={handleApplyCustom}
              disabled={!canApplyCustom}
            >
              {t('room.manage.msgTtlCustomApply')}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>,
    document.body,
  );
}
