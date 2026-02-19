import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisualFingerprintElement, UserInfo } from '../../types';
import type { VerificationStatus } from '../../hooks/useVerification';
import { VisualFingerprint } from '../VisualFingerprint';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { CheckIcon, AlertIcon, ShieldIcon } from '../../icons';
import './VerificationView.css';

interface VerificationViewProps {
  /** Visual fingerprint elements to display */
  fingerprint: VisualFingerprintElement[];
  /** Current verification status */
  status: VerificationStatus | null;
  /** Peer user info */
  peer: UserInfo | null;
  /** Session ID */
  sessionId: string;
  /** Callback when user confirms verification */
  onConfirm: () => void;
  /** Callback when user reports mismatch */
  onMismatch: () => void;
  /** Callback to continue to chat */
  onContinue: () => void;
  /** Whether verification is loading */
  isLoading?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Verification view component for fingerprint confirmation.
 * 
 * Displays the visual fingerprint and allows users to confirm
 * that it matches their peer's fingerprint, providing protection
 * against MITM attacks.
 */
export function VerificationView({
  fingerprint,
  status,
  peer,
  sessionId: _sessionId,
  onConfirm,
  onMismatch,
  onContinue,
  isLoading = false,
  className = '',
}: VerificationViewProps) {
  const { t } = useTranslation();
  // sessionId is currently unused but kept in the interface for future use
  void _sessionId;
  const selfVerified = status?.selfVerified ?? false;
  const peerVerified = status?.peerVerified ?? false;
  const bothVerified = status?.bothVerified ?? false;
  const mismatchReported = status?.mismatchReported ?? false;

  // Determine the current state
  const viewState = useMemo(() => {
    if (mismatchReported) return 'mismatch';
    if (bothVerified) return 'both_verified';
    if (selfVerified) return 'waiting_peer';
    return 'pending';
  }, [mismatchReported, bothVerified, selfVerified]);

  return (
    <div className={`verification-view ${className}`}>
      <div className="verification-view__content animate-slide-up">
        {/* Header */}
        <div className="verification-view__header">
          <ShieldIcon size={32} className="verification-view__header-icon" />
          <h2 className="verification-view__title">
            {viewState === 'mismatch' ? t('verification.titleMismatch') :
             viewState === 'both_verified' ? t('verification.titleVerified') :
             t('verification.titlePending')}
          </h2>
          <p className="verification-view__subtitle">
            {viewState === 'mismatch' 
              ? t('verification.subtitleMismatch')
              : viewState === 'both_verified'
              ? t('verification.subtitleVerified')
              : t('verification.subtitlePending')}
          </p>
        </div>

        {/* Fingerprint display */}
        {!mismatchReported && (
          <div className="verification-view__fingerprint-container">
            <VisualFingerprint
              elements={fingerprint}
              size="lg"
              showLabel
              showHint={viewState === 'pending'}
              verified={bothVerified}
            />
          </div>
        )}

        {/* Mismatch warning */}
        {mismatchReported && (
          <div className="verification-view__mismatch-warning">
            <AlertIcon size={48} className="verification-view__mismatch-icon" />
            <p className="verification-view__mismatch-text">
              {t('verification.mismatchWarning')}
            </p>
          </div>
        )}

        {/* Peer info */}
        {peer && (
          <Card className="verification-view__peer-card">
            <CardContent>
              <div className="verification-view__peer">
                <Avatar
                  src={peer.photoUrl}
                  name={peer.displayName}
                  size="md"
                />
                <div className="verification-view__peer-info">
                  <h3 className="verification-view__peer-name">
                    {peer.displayName}
                    {peer.premium && (
                      <span className="verification-view__premium" title="Premium">
                        &#11088;
                      </span>
                    )}
                  </h3>
                  {peer.username && (
                    <p className="verification-view__peer-username">
                      @{peer.username}
                    </p>
                  )}
                </div>
                <PeerVerificationBadge
                  verified={peerVerified}
                  mismatch={mismatchReported}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Verification status */}
        <div className="verification-view__status">
          <VerificationStatusItem
            label={t('verification.yourVerification')}
            verified={selfVerified}
            mismatch={mismatchReported}
          />
          <VerificationStatusItem
            label={t('verification.peerVerification')}
            verified={peerVerified}
            mismatch={mismatchReported}
            isPeer
          />
        </div>

        {/* Actions */}
        <div className="verification-view__actions">
          {viewState === 'pending' && (
            <>
              <Button
                variant="primary"
                onClick={onConfirm}
                disabled={isLoading}
                fullWidth
                leftIcon={<CheckIcon size={18} />}
              >
                {t('verification.matchButton')}
              </Button>
              <Button
                variant="destructive"
                onClick={onMismatch}
                disabled={isLoading}
                fullWidth
                leftIcon={<AlertIcon size={18} />}
              >
                {t('verification.mismatchButton')}
              </Button>
            </>
          )}

          {viewState === 'waiting_peer' && (
            <>
              <div className="verification-view__waiting">
                <div className="verification-view__waiting-spinner" />
                <span>{t('verification.waitingPeer')}</span>
              </div>
              <Button
                variant="secondary"
                onClick={onContinue}
                fullWidth
              >
                {t('verification.skipButton')}
              </Button>
            </>
          )}

          {viewState === 'both_verified' && (
            <Button
              variant="primary"
              onClick={onContinue}
              fullWidth
            >
              {t('verification.continueButton')}
            </Button>
          )}

          {viewState === 'mismatch' && (
            <>
              <Button
                variant="destructive"
                onClick={onContinue}
                fullWidth
              >
                {t('verification.continueAnywayButton')}
              </Button>
            </>
          )}
        </div>

        {/* Help text */}
        {viewState === 'pending' && (
          <p className="verification-view__help">
            {t('verification.helpText')}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

interface VerificationStatusItemProps {
  label: string;
  verified: boolean;
  mismatch: boolean;
  isPeer?: boolean;
}

function VerificationStatusItem({ 
  label, 
  verified, 
  mismatch,
  isPeer = false,
}: VerificationStatusItemProps) {
  const { t } = useTranslation();
  const getStatusText = () => {
    if (mismatch) return t('verification.statusMismatch');
    if (verified) return t('verification.statusVerified');
    if (isPeer) return t('verification.statusPending');
    return t('verification.statusNotVerified');
  };

  const getStatusClass = () => {
    if (mismatch) return 'verification-status--mismatch';
    if (verified) return 'verification-status--verified';
    return 'verification-status--pending';
  };

  return (
    <div className={`verification-status ${getStatusClass()}`}>
      <span className="verification-status__label">{label}</span>
      <span className="verification-status__value">
        {verified && !mismatch && <CheckIcon size={14} />}
        {mismatch && <AlertIcon size={14} />}
        {getStatusText()}
      </span>
    </div>
  );
}

interface PeerVerificationBadgeProps {
  verified: boolean;
  mismatch: boolean;
}

function PeerVerificationBadge({ verified, mismatch }: PeerVerificationBadgeProps) {
  if (mismatch) {
    return (
      <div className="peer-badge peer-badge--mismatch" title="Mismatch reported">
        <AlertIcon size={16} />
      </div>
    );
  }
  
  if (verified) {
    return (
      <div className="peer-badge peer-badge--verified" title="Verified">
        <CheckIcon size={16} />
      </div>
    );
  }

  return (
    <div className="peer-badge peer-badge--pending" title="Not yet verified">
      <span>?</span>
    </div>
  );
}
