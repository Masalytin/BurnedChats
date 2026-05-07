import { createContext, useContext, type ReactNode } from 'react';

import type { UseGovernance } from '@/hooks/useGovernance';

const GovernanceStateContext = createContext<UseGovernance | null>(null);

export function GovernanceStateProvider({
  value,
  children,
}: {
  value: UseGovernance;
  children: ReactNode;
}) {
  return <GovernanceStateContext.Provider value={value}>{children}</GovernanceStateContext.Provider>;
}

export function useGovernanceState(): UseGovernance {
  const ctx = useContext(GovernanceStateContext);
  if (!ctx) {
    throw new Error('useGovernanceState must be used inside GovernanceStateProvider');
  }
  return ctx;
}
