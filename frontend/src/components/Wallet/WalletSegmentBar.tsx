import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useTelegram } from '@/hooks/useTelegram';

import { navigateWalletSegment } from './walletSegmentNavigation';
import { WalletSegmentControl, type WalletSegment } from './WalletSegmentControl';

interface WalletSegmentBarProps {
  activeSegment: WalletSegment;
  /** Optional hook for parent pages that keep segment in React state (e.g. WalletPage). */
  onSegmentChange?: (next: WalletSegment) => void;
}

/**
 * Shared Wallet | Staking | Governance switcher for all wallet-tab surfaces.
 * Keeps segment choice in sessionStorage and routes to the matching path.
 */
export function WalletSegmentBar({ activeSegment, onSegmentChange }: WalletSegmentBarProps) {
  const navigate = useNavigate();
  const { selectionChanged } = useTelegram();

  const handleSegmentChange = useCallback(
    (next: WalletSegment) => {
      if (next === activeSegment) {
        return;
      }

      selectionChanged();
      onSegmentChange?.(next);
      navigateWalletSegment(next, navigate);
    },
    [activeSegment, navigate, onSegmentChange, selectionChanged],
  );

  return <WalletSegmentControl activeSegment={activeSegment} onChange={handleSegmentChange} />;
}
