import type { NavigateFunction } from 'react-router-dom';

import { writeWalletSegment, type WalletSegment } from './WalletSegmentControl';

/** Navigate to the route that matches the wallet surface segment. */
export function navigateWalletSegment(next: WalletSegment, navigate: NavigateFunction): void {
  writeWalletSegment(next);
  if (next === 'governance') {
    navigate('/app/governance');
    return;
  }
  navigate('/app/wallet');
}
