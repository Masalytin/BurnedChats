import { useTranslation } from 'react-i18next';
import type { VisualFingerprintElement } from '../../types';
import { CheckIcon, FingerprintIcon } from '../../icons';
import './VisualFingerprint.css';

type FingerprintSize = 'sm' | 'md' | 'lg';

interface VisualFingerprintProps {
  /** Emoji fingerprint slots (alphabet v1 — see IMP-FPEMOJI-01) */
  elements: VisualFingerprintElement[];
  /** Size variant */
  size?: FingerprintSize;
  /** Whether to show the label */
  showLabel?: boolean;
  /** Optional label text override */
  label?: string;
  /** Whether to show the hint text */
  showHint?: boolean;
  /** Whether the fingerprint is verified */
  verified?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Visual Fingerprint component for security verification.
 *
 * Displays the emoji fingerprint slots that users compare out-of-band to verify
 * their encryption keys match, protecting against MITM attacks. The number of
 * slots is driven by the elements array (no hard-coded count); an empty array
 * renders nothing.
 *
 * @example
 * ```tsx
 * <VisualFingerprint
 *   elements={[{ emoji: '🦊' }, { emoji: '🍎' }, { emoji: '🚀' }]}
 *   showLabel
 *   showHint
 * />
 * ```
 */
export function VisualFingerprint({
  elements,
  size = 'md',
  showLabel = false,
  label,
  showHint = false,
  verified = false,
  className = '',
}: VisualFingerprintProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('fingerprint.label');
  if (elements.length === 0) {
    console.warn('VisualFingerprint: empty fingerprint, nothing to render');
    return null;
  }

  return (
    <div className={`visual-fingerprint visual-fingerprint--${size} ${verified ? 'visual-fingerprint--verified' : ''} ${className}`}>
      {showLabel && (
        <div className="visual-fingerprint__header">
          <FingerprintIcon size={16} className="visual-fingerprint__icon" />
          <span className="visual-fingerprint__label">{resolvedLabel}</span>
          {verified && (
            <span className="visual-fingerprint__verified-badge" title={t('verification.statusVerified')}>
              <CheckIcon size={10} aria-hidden="true" />
            </span>
          )}
        </div>
      )}
      
      <div className="visual-fingerprint__elements">
        {elements.map((element, index) => (
          <div
            key={index}
            className="visual-fingerprint__element"
            title={element.emoji}
          >
            <span className="visual-fingerprint__emoji" role="img" aria-label={element.emoji}>
              {element.emoji}
            </span>
          </div>
        ))}
      </div>
      
      {showHint && (
        <p className="visual-fingerprint__hint">
          {t('fingerprint.compareHint')}
        </p>
      )}
    </div>
  );
}

/**
 * Compact fingerprint display for inline use (e.g., in chat header).
 */
export function VisualFingerprintCompact({
  elements,
  verified = false,
  className = '',
}: Pick<VisualFingerprintProps, 'elements' | 'verified' | 'className'>) {
  const { t } = useTranslation();
  if (elements.length === 0) {
    return null;
  }

  return (
    <div className={`visual-fingerprint-compact ${verified ? 'visual-fingerprint-compact--verified' : ''} ${className}`}>
      {elements.map((element, index) => (
        <span
          key={index}
          className="visual-fingerprint-compact__emoji"
          role="img"
          aria-label={element.emoji}
        >
          {element.emoji}
        </span>
      ))}
      {verified && (
        <span className="visual-fingerprint-compact__check" title={t('verification.statusVerified')}>
          <CheckIcon size={10} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
