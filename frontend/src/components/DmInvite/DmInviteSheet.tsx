import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Share2 } from 'lucide-react';
import type { PowPhase } from '../../hooks/usePow';
import type { DmInvitePhase } from '../../hooks/useDmInvite';
import { getEnvironment } from '../../env/detector';
import { buildTelegramShareUrl } from '../../utils/inviteLink';
import { CopyIcon } from '../../icons';
import { Button } from '../Button';
import { PowProgress } from '../Pow/PowProgress';
import { useTelegram } from '../../hooks/useTelegram';
import './DmInviteSheet.css';

export interface DmInviteSheetProps {
  open: boolean;
  onClose: () => void;
  phase: DmInvitePhase;
  qrUrl: string | null;
  inviteUrl: string | null;
  errorMessage: string | null;
  powPhase: PowPhase;
  powProgressIterations: number;
  onMint: () => void;
}

/**
 * Sheet: mint personal DM invite → show QR + copy/share (IMP-DMINVITE-02).
 * No in-app camera — that is IMP-DMINVITE-03.
 */
export function DmInviteSheet({
  open,
  onClose,
  phase,
  qrUrl,
  inviteUrl,
  errorMessage,
  powPhase,
  powProgressIterations,
  onMint,
}: DmInviteSheetProps) {
  const { t } = useTranslation();
  const { impactOccurred, openTelegramLink } = useTelegram();
  const [copied, setCopied] = useState(false);
  const showShare = getEnvironment() === 'telegram';
  const showPow =
    phase === 'minting'
    || powPhase === 'requesting'
    || powPhase === 'solving'
    || powPhase === 'error';
  const ready = phase === 'ready' && qrUrl != null && inviteUrl != null;

  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (phase !== 'ready' && phase !== 'minting') {
      onMint();
    }
    // Mint once when the sheet opens unless an invite is already ready / in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on open
  }, [open]);

  const handleCopy = useCallback(async () => {
    if (!inviteUrl) return;
    impactOccurred('light');
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }, [impactOccurred, inviteUrl]);

  const handleShare = useCallback(() => {
    if (!inviteUrl) return;
    impactOccurred('light');
    openTelegramLink(buildTelegramShareUrl(inviteUrl, t('dmInvite.shareMessage')));
  }, [impactOccurred, inviteUrl, openTelegramLink, t]);

  const handleRemint = useCallback(() => {
    impactOccurred('light');
    onMint();
  }, [impactOccurred, onMint]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dm-invite-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dm-invite-sheet-title"
      onClick={onClose}
    >
      <div
        className="dm-invite-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="dm-invite-sheet-title" className="dm-invite-sheet__title">
          {t('dmInvite.title')}
        </h3>

        {showPow && (
          <div className="dm-invite-sheet__pow">
            <PowProgress
              phase={powPhase === 'idle' ? 'requesting' : powPhase}
              progressIterations={powProgressIterations}
            />
            <p className="dm-invite-sheet__status">{t('dmInvite.minting')}</p>
          </div>
        )}

        {phase === 'error' && errorMessage && (
          <p className="dm-invite-sheet__error" role="alert">
            {errorMessage}
          </p>
        )}

        {ready && (
          <>
            <div className="dm-invite-sheet__code" aria-hidden="true">
              <QRCodeSVG value={qrUrl} size={200} level="M" />
            </div>
            <p className="dm-invite-sheet__caption">{t('dmInvite.caption')}</p>
            <p className="dm-invite-sheet__url" title={inviteUrl}>{inviteUrl}</p>
            <div className="dm-invite-sheet__actions">
              <Button
                variant="secondary"
                onClick={handleCopy}
                fullWidth
                aria-label={t('common.copy')}
              >
                <CopyIcon size={16} aria-hidden="true" />
                {copied ? t('common.copied') : t('dmInvite.copy')}
              </Button>
              {showShare && (
                <Button
                  variant="secondary"
                  onClick={handleShare}
                  fullWidth
                  aria-label={t('dmInvite.share')}
                >
                  <Share2 size={16} aria-hidden="true" />
                  {t('dmInvite.share')}
                </Button>
              )}
              <Button variant="primary" onClick={handleRemint} fullWidth>
                {t('dmInvite.remintButton')}
              </Button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <Button variant="primary" onClick={handleRemint} fullWidth>
            {t('dmInvite.remintButton')}
          </Button>
        )}

        <Button variant="secondary" onClick={onClose} fullWidth>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
