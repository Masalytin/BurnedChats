import { useTranslation } from 'react-i18next';
import { Key, Link2 } from 'lucide-react';
import { Button } from '../Button';
import './JoinLanding.css';

export interface JoinLandingProps {
  /** When false, show invalid-link state (missing or malformed fragment). */
  valid?: boolean;
  /** Invite token from URL fragment; required when valid is true. */
  token?: string;
  /** Opens Telegram Mini App deep link. */
  onOpenTelegram?: () => void;
  /** Wallet login in progress (browser continue path). */
  isLoginBusy?: boolean;
  /** Triggers TonConnect wallet login in browser. */
  onContinueInBrowser?: () => void;
}

/**
 * Landing for web invite links (`/join#invite_{token}`).
 * Telegram deep link is the primary action for in-app browser users without initData.
 */
export function JoinLanding({
  valid = false,
  onOpenTelegram,
  isLoginBusy = false,
  onContinueInBrowser,
}: JoinLandingProps) {
  const { t } = useTranslation();

  if (!valid) {
    return (
      <div className="join-landing">
        <div className="join-landing__card">
          <div className="join-landing__icon join-landing__icon--error" aria-hidden="true">
            <Link2 size={36} strokeWidth={1.75} />
          </div>
          <h1 className="join-landing__title">{t('joinLanding.invalidTitle')}</h1>
          <p className="join-landing__subtitle">{t('joinLanding.invalidHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="join-landing">
      <div className="join-landing__card">
        <div className="join-landing__icon" aria-hidden="true">
          <Key size={36} strokeWidth={1.75} />
        </div>
        <h1 className="join-landing__title">{t('joinLanding.title')}</h1>
        <p className="join-landing__subtitle">{t('joinLanding.subtitle')}</p>

        <div className="join-landing__actions">
          <Button type="button" fullWidth onClick={onOpenTelegram}>
            {t('joinLanding.openInTelegram')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            fullWidth
            isLoading={isLoginBusy}
            onClick={() => onContinueInBrowser?.()}
          >
            {t('joinLanding.continueInBrowser')}
          </Button>
        </div>
      </div>
    </div>
  );
}
