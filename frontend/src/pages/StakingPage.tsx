import { StakingDashboard } from '@/components/Staking/StakingDashboard';
import { WalletSegmentBar } from '@/components/Wallet/WalletSegmentBar';

import './WalletPage.css';

/**
 * Standalone staking route page (mounted under `/app/staking`).
 */
export function StakingPage({ showSegmentBar = false }: { showSegmentBar?: boolean }) {
  return (
    <div className="wallet-page">
      {showSegmentBar ? <WalletSegmentBar activeSegment="staking" /> : null}
      <StakingDashboard />
    </div>
  );
}
