import { useCallback, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { StakingPage } from './StakingPage';
import './WalletPage.css';

const WALLET_SEGMENT_KEY = 'bc:wallet:segment';

type WalletSegment = 'staking' | 'governance';

function readWalletSegment(): WalletSegment {
  try {
    const value = sessionStorage.getItem(WALLET_SEGMENT_KEY);
    if (value === 'staking' || value === 'governance') {
      return value;
    }
  } catch {
    // sessionStorage unavailable (SSR / private mode)
  }
  return 'staking';
}

function writeWalletSegment(segment: WalletSegment): void {
  try {
    sessionStorage.setItem(WALLET_SEGMENT_KEY, segment);
  } catch {
    // ignore write failures
  }
}

interface WalletSegmentControlProps {
  activeSegment: WalletSegment;
  onChange: (segment: WalletSegment) => void;
}

function WalletSegmentControl({ activeSegment, onChange }: WalletSegmentControlProps) {
  const { t } = useTranslation();
  const activeIndex = activeSegment === 'governance' ? 1 : 0;

  const pillStyle = {
    '--pill-index': activeIndex,
    '--pill-count': 2,
  } as CSSProperties;

  const segments: WalletSegment[] = ['staking', 'governance'];

  return (
    <div className="wallet-segment" role="tablist" aria-label={t('nav.wallet')}>
      <div className="wallet-segment__pill" style={pillStyle} aria-hidden="true" />
      {segments.map((segment) => {
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

/**
 * Wallet tab: segmented Staking | Governance entry (IMP-NAV-03).
 * Governance navigates to `/app/governance`; segment choice persists in sessionStorage.
 */
export function WalletPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectionChanged } = useTelegram();
  const [segment, setSegment] = useState<WalletSegment>(() => readWalletSegment());

  useLayoutEffect(() => {
    if (segment === 'governance') {
      navigate('/app/governance', { replace: true });
    }
  }, [navigate, segment]);

  const handleSegmentChange = useCallback(
    (next: WalletSegment) => {
      if (next === segment) {
        return;
      }

      selectionChanged();
      writeWalletSegment(next);
      setSegment(next);

      if (next === 'governance') {
        navigate('/app/governance');
      }
    },
    [navigate, segment, selectionChanged],
  );

  if (segment === 'governance') {
    return null;
  }

  return (
    <div className="wallet-page">
      <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
      <WalletSegmentControl activeSegment="staking" onChange={handleSegmentChange} />
      <StakingPage />
    </div>
  );
}
