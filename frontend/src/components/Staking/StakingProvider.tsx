import { type ReactNode } from 'react';

import { StakingContext, useStakingController } from '@/hooks/useStaking';

/** Authenticated-app store: one loadCore / poller for every `useStaking()` consumer. */
export function StakingProvider({ children }: { children: ReactNode }) {
  const value = useStakingController();
  return <StakingContext.Provider value={value}>{children}</StakingContext.Provider>;
}
