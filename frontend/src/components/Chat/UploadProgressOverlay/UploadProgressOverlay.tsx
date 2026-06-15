import { memo, useCallback } from 'react';
import { RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './UploadProgressOverlay.css';

export type UploadStage = 'encrypting' | 'uploading' | 'sending' | 'failed';

interface UploadProgressOverlayProps {
  /** 0-100 percent */
  progress: number;
  stage: UploadStage;
  onCancel: () => void;
  onRetry?: () => void;
}

/**
 * Upload progress overlay for message bubbles (P4-4-1-3).
 *
 * Renders on top of the message placeholder during file upload.
 * Shows a circular progress indicator, stage label, and cancel/retry button.
 */
export const UploadProgressOverlay = memo(function UploadProgressOverlay({
  progress,
  stage,
  onCancel,
  onRetry,
}: UploadProgressOverlayProps) {
  const { t } = useTranslation();
  const isFailed = stage === 'failed';

  const handleAction = useCallback(() => {
    if (isFailed && onRetry) {
      onRetry();
    } else {
      onCancel();
    }
  }, [isFailed, onRetry, onCancel]);

  const stageLabel = t(`files.upload.${stage}`);
  const pct = Math.min(100, Math.max(0, Math.round(progress)));

  const RADIUS = 20;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  return (
    <div className={`upload-overlay ${isFailed ? 'upload-overlay--failed' : ''}`}>
      {!isFailed ? (
        <button
          type="button"
          className="upload-overlay-circle-btn"
          onClick={onCancel}
          aria-label={t('files.preview.cancel')}
        >
          <svg className="upload-overlay-svg" viewBox="0 0 48 48">
            {/* Track */}
            <circle
              className="upload-overlay-track"
              cx="24"
              cy="24"
              r={RADIUS}
              fill="none"
              strokeWidth="3"
            />
            {/* Progress arc */}
            <circle
              className="upload-overlay-arc"
              cx="24"
              cy="24"
              r={RADIUS}
              fill="none"
              strokeWidth="3"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 24 24)"
            />
          </svg>
          <X className="upload-overlay-x" size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="upload-overlay-retry-btn"
          onClick={handleAction}
          aria-label={t('files.upload.retry')}
        >
          <RotateCw size={22} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      <span className="upload-overlay-label">
        {isFailed ? stageLabel : `${stageLabel} ${pct}%`}
      </span>
    </div>
  );
});
