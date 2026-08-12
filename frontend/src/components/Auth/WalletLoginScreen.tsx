import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WalletAuthError } from '../../auth/WalletAuthProvider';
import { useAuth } from '../../hooks/useAuth';
import { FlameIcon } from '../../icons';
import { classifyWalletConnectError } from '../../ton/connector';
import { AuthErrorDisplay } from './AuthErrorDisplay';
import { WalletConnectButton } from './WalletConnectButton';
import './WalletLoginScreen.css';

type UiState = 'idle' | 'busy' | 'error';

function mapProofError(error: WalletAuthError, t: ReturnType<typeof useTranslation>['t']): string {
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

function mapConnectError(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (error instanceof WalletAuthError) {
    console.error('[WalletAuth] proof rejected', {
      code: error.code,
      message: error.serverMessage,
    });
    return mapProofError(error, t);
  }

  const kind = classifyWalletConnectError(error);
  console.error('[WalletAuth] connect failed', { kind, error });

  switch (kind) {
    case 'user_rejected':
      return t('walletLogin.errorRejected');
    case 'csp_blocked':
      return t('walletLogin.errorCspBlocked');
    case 'manifest_invalid':
      return t('walletLogin.errorManifestInvalid');
    case 'network':
      return t('walletLogin.errorNetwork');
    case 'proof_failed':
      return t('walletLogin.errorProof');
    case 'wallet_error':
      return t('walletLogin.errorWallet');
    case 'unknown':
    default:
      return t('walletLogin.errorGeneric');
  }
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
        <FlameIcon className="wallet-login-screen__logo" size={56} aria-hidden />

        <h1 className="wallet-login-screen__title">{t('walletLogin.title')}</h1>
        <p className="wallet-login-screen__subtitle">{t('walletLogin.subtitle')}</p>

        <p className="wallet-login-screen__wallets">{t('walletLogin.supportedWallets')}</p>

        <WalletConnectButton state={uiState === 'busy' ? 'busy' : 'idle'} onPress={handleConnect} />

        <AuthErrorDisplay message={errorMessage} />
      </div>
    </div>
  );
}
