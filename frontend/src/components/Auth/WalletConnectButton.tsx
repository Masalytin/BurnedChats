import type { MouseEventHandler } from 'react';
import { useTranslation } from 'react-i18next';

import './WalletConnectButton.css';

interface WalletConnectButtonProps {
  state: 'idle' | 'busy';
  onPress: MouseEventHandler<HTMLButtonElement>;
}

export function WalletConnectButton({ state, onPress }: WalletConnectButtonProps) {
  const { t } = useTranslation();

  const label = state === 'idle' ? t('walletLogin.connect') : t('walletLogin.busy');
  const isBusy = state === 'busy';

  return (
    <button type="button" className="wallet-connect-button" disabled={isBusy} onClick={onPress}>
      {isBusy ? <span className="wallet-connect-button__spinner" aria-hidden /> : null}
      <span>{label}</span>
    </button>
  );
}
