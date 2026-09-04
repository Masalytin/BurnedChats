import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Timer, X } from 'lucide-react';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { DurationScrollPicker } from '@/components/DurationScrollPicker';
import {
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_PRESETS,
  matchMessageTtlPreset,
  type MessageTtlPreset,
} from '@/utils/messageTtlPresets';
import {
  partsToSeconds,
  secondsToParts,
  type DurationParts,
} from '@/utils/durationColumns';
import { secondsToBestUnit, validateDurationSeconds } from '@/utils/duration';
import './MessageTtlSheet.css';

export interface MessageTtlSheetProps {
  open: boolean;
  onClose: () => void;
  messageTtlSeconds: number;
  onApplyPreset: (preset: MessageTtlPreset) => void;
  onApplyCustomSeconds: (seconds: number) => void;
}

const ZERO_PARTS: DurationParts = [0, 0, 0];

function msgTtlPresetLabelKey(preset: MessageTtlPreset): string {
  if (preset === 'off') return 'room.manage.msgTtlPresetOff';
  if (preset === '5m') return 'room.manage.msgTtlPreset5m';
  if (preset === '1h') return 'room.manage.msgTtlPreset1h';
  return 'room.manage.msgTtlPreset24h';
}

function formatBoundLabel(seconds: number, t: (key: string) => string): string {
  const { value, unit } = secondsToBestUnit(seconds);
  const unitKey =
    unit === 'minute'
      ? 'common.duration.unitMinutes'
      : unit === 'hour'
        ? 'common.duration.unitHours'
        : 'common.duration.unitDays';
  return `${value} ${t(unitKey)}`;
}

/**
 * Message-TTL presets + custom HMS scroll picker (shared DM / room header).
 */
export function MessageTtlSheet({
  open,
  onClose,
  messageTtlSeconds,
  onApplyPreset,
  onApplyCustomSeconds,
}: MessageTtlSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [isCustomExpanded, setIsCustomExpanded] = useState(false);
  const [draftParts, setDraftParts] = useState<DurationParts>(ZERO_PARTS);

  const activePreset = matchMessageTtlPreset(messageTtlSeconds);
  const isCustomActive = activePreset === null && messageTtlSeconds > 0;
  const showCustomPanel = isCustomExpanded || isCustomActive;
  const draftSeconds = partsToSeconds('hms', draftParts);
  const customValidation = validateDurationSeconds(draftSeconds, {
    min: MESSAGE_TTL_CUSTOM_MIN_SECONDS,
    max: MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  });
  const canApplyCustom = customValidation === 'ok';

  useEffect(() => {
    if (activePreset !== null) {
      setIsCustomExpanded(false);
      return;
    }
    if (messageTtlSeconds > 0) {
      setIsCustomExpanded(true);
      setDraftParts(secondsToParts('hms', messageTtlSeconds));
    }
  }, [activePreset, messageTtlSeconds]);

  const handleSelectPreset = useCallback((preset: MessageTtlPreset) => {
    setIsCustomExpanded(false);
    onApplyPreset(preset);
  }, [onApplyPreset]);

  const handleSelectCustom = useCallback(() => {
    setIsCustomExpanded(true);
    if (messageTtlSeconds > 0 && activePreset === null) {
      setDraftParts(secondsToParts('hms', messageTtlSeconds));
    } else {
      setDraftParts(ZERO_PARTS);
    }
  }, [messageTtlSeconds, activePreset]);

  const handleCommitParts = useCallback((parts: DurationParts) => {
    setDraftParts(parts);
  }, []);

  const handleApplyCustom = useCallback(() => {
    if (!canApplyCustom) {
      return;
    }
    onApplyCustomSeconds(draftSeconds);
  }, [canApplyCustom, draftSeconds, onApplyCustomSeconds]);

  if (!open) {
    return null;
  }

  const customError =
    customValidation === 'below-min'
      ? t('common.duration.errorBelowMin', {
          min: formatBoundLabel(MESSAGE_TTL_CUSTOM_MIN_SECONDS, t),
        })
      : customValidation === 'above-max'
        ? t('common.duration.errorAboveMax', {
            max: formatBoundLabel(MESSAGE_TTL_CUSTOM_MAX_SECONDS, t),
          })
        : undefined;

  return createPortal(
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      reducedMotionAware
      initialFocusRef={closeBtnRef}
      backdropClassName="msg-ttl-sheet-backdrop"
      panelClassName="msg-ttl-sheet-panel"
    >
      <header className="msg-ttl-sheet-header">
        <h2 id={titleId} className="msg-ttl-sheet-title">
          <Timer size={16} aria-hidden="true" />
          {t('room.manage.msgTtlTitle')}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="msg-ttl-sheet-close"
          onClick={onClose}
          aria-label={t('aria.closeDialog')}
        >
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
      </header>
      <div className="msg-ttl-sheet-body">
        <div
          className="msg-ttl-sheet-presets"
          role="group"
          aria-label={t('room.manage.msgTtlTitle')}
        >
          {MESSAGE_TTL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`msg-ttl-sheet-chip${
                activePreset === preset ? ' msg-ttl-sheet-chip--active' : ''
              }`}
              onClick={() => handleSelectPreset(preset)}
            >
              {t(msgTtlPresetLabelKey(preset))}
            </button>
          ))}
          <button
            type="button"
            className={`msg-ttl-sheet-chip${
              isCustomExpanded || isCustomActive ? ' msg-ttl-sheet-chip--active' : ''
            }`}
            onClick={handleSelectCustom}
          >
            {t('room.manage.msgTtlPresetCustom')}
          </button>
        </div>
        {showCustomPanel && (
          <div className="msg-ttl-sheet-custom">
            <span className="msg-ttl-sheet-custom-label">
              {t('room.manage.msgTtlCustomLabel')}
            </span>
            <DurationScrollPicker
              mode="hms"
              valueParts={draftParts}
              onCommitParts={handleCommitParts}
              minSeconds={MESSAGE_TTL_CUSTOM_MIN_SECONDS}
              maxSeconds={MESSAGE_TTL_CUSTOM_MAX_SECONDS}
              ariaLabel={t('room.manage.msgTtlCustomLabel')}
            />
            {customError && (
              <p className="msg-ttl-sheet-custom-error" role="alert">
                {customError}
              </p>
            )}
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
