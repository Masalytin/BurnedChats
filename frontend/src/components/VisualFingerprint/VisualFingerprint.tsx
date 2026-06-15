import type { VisualFingerprintElement, FingerprintColor } from '../../types';
import { CheckIcon, FingerprintIcon } from '../../icons';
import './VisualFingerprint.css';

type FingerprintSize = 'sm' | 'md' | 'lg';

interface VisualFingerprintProps {
  /** Array of 4 fingerprint elements (shape + color) */
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

/** Map colors to CSS custom properties */
const COLOR_MAP: Record<FingerprintColor, string> = {
  red: 'var(--fingerprint-red)',
  blue: 'var(--fingerprint-blue)',
  green: 'var(--fingerprint-green)',
  purple: 'var(--fingerprint-purple)',
  orange: 'var(--fingerprint-orange)',
  cyan: 'var(--fingerprint-cyan)',
};

/**
 * Visual Fingerprint component for security verification.
 * 
 * Displays 4 colored geometric shapes that users can compare
 * out-of-band to verify their encryption keys match. This helps
 * protect against MITM attacks.
 * 
 * @example
 * ```tsx
 * <VisualFingerprint
 *   elements={[
 *     { shape: '◆', color: 'red' },
 *     { shape: '○', color: 'blue' },
 *     { shape: '□', color: 'green' },
 *     { shape: '△', color: 'purple' }
 *   ]}
 *   showLabel
 *   showHint
 * />
 * ```
 */
export function VisualFingerprint({
  elements,
  size = 'md',
  showLabel = false,
  label = 'Security Fingerprint',
  showHint = false,
  verified = false,
  className = '',
}: VisualFingerprintProps) {
  // Ensure we have exactly 4 elements
  const displayElements = elements.slice(0, 4);
  
  if (displayElements.length < 4) {
    console.warn('VisualFingerprint: Expected 4 elements, got', displayElements.length);
    return null;
  }

  return (
    <div className={`visual-fingerprint visual-fingerprint--${size} ${verified ? 'visual-fingerprint--verified' : ''} ${className}`}>
      {showLabel && (
        <div className="visual-fingerprint__header">
          <FingerprintIcon size={16} className="visual-fingerprint__icon" />
          <span className="visual-fingerprint__label">{label}</span>
          {verified && (
            <span className="visual-fingerprint__verified-badge" title="Verified">
              <CheckIcon size={10} aria-hidden="true" />
            </span>
          )}
        </div>
      )}
      
      <div className="visual-fingerprint__elements">
        {displayElements.map((element, index) => (
          <div
            key={index}
            className="visual-fingerprint__element"
            style={{ color: COLOR_MAP[element.color] }}
            title={`${element.shape} ${element.color}`}
          >
            <span className="visual-fingerprint__shape">{element.shape}</span>
          </div>
        ))}
      </div>
      
      {showHint && (
        <p className="visual-fingerprint__hint">
          Compare these symbols with your peer to verify the connection
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
  const displayElements = elements.slice(0, 4);
  
  if (displayElements.length < 4) {
    return null;
  }

  return (
    <div className={`visual-fingerprint-compact ${verified ? 'visual-fingerprint-compact--verified' : ''} ${className}`}>
      {displayElements.map((element, index) => (
        <span
          key={index}
          className="visual-fingerprint-compact__shape"
          style={{ color: COLOR_MAP[element.color] }}
        >
          {element.shape}
        </span>
      ))}
      {verified && (
        <span className="visual-fingerprint-compact__check" title="Verified">
          <CheckIcon size={10} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
