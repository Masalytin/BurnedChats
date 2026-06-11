import { useCallback, useContext, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
import { useTelegram } from '../hooks/useTelegram';
import { StakingPage } from './StakingPage';
import './WalletPage.css';

const WALLET_SEGMENT_KEY = 'bc:wallet:segment';

type WalletSegment = 'wallet' | 'staking' | 'governance';

const SEGMENT_ORDER: WalletSegment[] = ['wallet', 'staking', 'governance'];

function readWalletSegment(): WalletSegment {
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

function writeWalletSegment(segment: WalletSegment): void {
  try {
    sessionStorage.setItem(WALLET_SEGMENT_KEY, segment);
  } catch {
    // ignore write failures
  }
}

function segmentIndex(segment: WalletSegment): number {
  return SEGMENT_ORDER.indexOf(segment);
}

interface WalletSegmentControlProps {
  activeSegment: WalletSegment;
  onChange: (segment: WalletSegment) => void;
}

function WalletSegmentControl({ activeSegment, onChange }: WalletSegmentControlProps) {
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

function WalletPanelSection() {
  const { t } = useTranslation();
  const walletCtx = useContext(WalletContext);

  if (!walletCtx) {
    return <p className="wallet-page__panel-loading">{t('wallet.balanceLoading')}</p>;
  }

  return (
    <div className="wallet-page__panel">
      <WalletPanel />
    </div>
  );
}

/**
 * Wallet tab: Wallet | Staking | Governance segments (IMP-WSURF-03).
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
      <WalletSegmentControl activeSegment={segment} onChange={handleSegmentChange} />
      {segment === 'wallet' ? <WalletPanelSection /> : <StakingPage />}
    </div>
  );
}
