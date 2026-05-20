import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WalletAuthError } from '../../auth/WalletAuthProvider';
import { useAuth } from '../../hooks/useAuth';
import { AuthErrorDisplay } from './AuthErrorDisplay';
import { WalletConnectButton } from './WalletConnectButton';

type UiState = 'idle' | 'busy' | 'error';

function mapConnectError(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (error instanceof WalletAuthError) {
    console.error('[WalletAuth] proof rejected', {
      code: error.code,
      message: error.serverMessage,
    });
    switch (error.code) {
      case 'PROOF_TIMESTAMP_FUTURE':
      case 'PROOF_EXPIRED':
        return t('walletLogin.errorProofTimestamp');
      case 'DOMAIN_MISMATCH':
      case 'DOMAIN_LENGTH_MISMATCH':
        return t('walletLogin.errorProofDomain');
      case 'NONCE_MISSING':
      case 'NONCE_UNKNOWN':
        return t('walletLogin.errorProofNonce');
      case 'PUBLIC_KEY_UNAVAILABLE':
        return t('walletLogin.errorProofPublicKey');
      case 'SIGNATURE_INVALID':
        return t('walletLogin.errorProofSignature');
      case 'INVALID_REQUEST':
      case 'ADDRESS_INVALID':
        return t('walletLogin.errorProofRequest');
      case 'INTERNAL':
      default:
        return t('walletLogin.errorProof');
    }
  }

  const msg = error instanceof Error ? error.message : '';
  const lower = msg.toLowerCase();
  if (lower.includes('cancel') || lower.includes('rejected')) {
    return t('walletLogin.errorRejected');
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('-proof') || lower.includes('invalid')) {
    return t('walletLogin.errorProof');
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return t('walletLogin.errorTimeout');
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return t('walletLogin.errorNetwork');
  }
  return t('walletLogin.errorGeneric');
}

/** Standalone browser: TON wallet entry (Ton Connect → ton_proof → backend session token) */
export function WalletLoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();

  const [uiState, setUiState] = useState<UiState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setErrorMessage(null);
    setUiState('busy');
    try {
      await login();
    } catch (e) {
      setErrorMessage(mapConnectError(e, t));
      setUiState('error');
      return;
    }
    setUiState('idle');
  }, [login, t]);

  return (
    <div className="wallet-login-screen">
      <div className="wallet-login-screen__card">
        <img className="wallet-login-screen__logo" src="/logo.png" alt="" width={56} height={56} />

        <h1 className="wallet-login-screen__title">{t('walletLogin.title')}</h1>
        <p className="wallet-login-screen__subtitle">{t('walletLogin.subtitle')}</p>

        <p className="wallet-login-screen__wallets">{t('walletLogin.supportedWallets')}</p>

        <WalletConnectButton state={uiState === 'busy' ? 'busy' : 'idle'} onPress={handleConnect} />

        <AuthErrorDisplay message={errorMessage} />
      </div>
    </div>
  );
}
