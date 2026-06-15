import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';

import './WalletSegmentControl.css';

const WALLET_SEGMENT_KEY = 'bc:wallet:segment';

export type WalletSegment = 'wallet' | 'staking' | 'governance';

export const SEGMENT_ORDER: WalletSegment[] = ['wallet', 'staking', 'governance'];

export function readWalletSegment(): WalletSegment {
  try {
    const value = sessionStorage.getItem(WALLET_SEGMENT_KEY);
    if (value === 'wallet' || value === 'staking' || value === 'governance') {
      return value;
    }
  } catch {
    // sessionStorage unavailable (SSR / private mode)
  }
  return 'wallet';
}

export function writeWalletSegment(segment: WalletSegment): void {
  try {
    sessionStorage.setItem(WALLET_SEGMENT_KEY, segment);
  } catch {
    // ignore write failures
  }
}

export function segmentIndex(segment: WalletSegment): number {
  return SEGMENT_ORDER.indexOf(segment);
}

interface WalletSegmentControlProps {
  activeSegment: WalletSegment;
  onChange: (segment: WalletSegment) => void;
}

/**
 * Wallet / Staking / Governance segmented control. Shared between {@link WalletPage}
 * and the Governance route shell so the switcher stays visible across all three
 * surfaces (IMP-WSURF-03 follow-up).
 */
export function WalletSegmentControl({ activeSegment, onChange }: WalletSegmentControlProps) {
  const { t } = useTranslation();

  const pillStyle = {
    '--pill-index': segmentIndex(activeSegment),
    '--pill-count': SEGMENT_ORDER.length,
  } as CSSProperties;

  return (
    <div className="wallet-segment" role="tablist" aria-label={t('nav.wallet')}>
      <div className="wallet-segment__pill" style={pillStyle} aria-hidden="true" />
      {SEGMENT_ORDER.map((segment) => {
        const isActive = segment === activeSegment;
        return (
          <button
            key={segment}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`wallet-segment__tab${isActive ? ' wallet-segment__tab--active' : ''}`}
            onClick={() => onChange(segment)}
          >
            {t(`wallet.segment.${segment}`)}
          </button>
        );
      })}
    </div>
  );
}
