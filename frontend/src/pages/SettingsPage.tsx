import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../auth/types';
import type { LinkedAccountsCredentials } from '../components/Settings/LinkedAccounts';

export interface SettingsPageProps {
  user: AuthUser | null;
  linkedAccountsCredentials: LinkedAccountsCredentials | null;
  onTonWalletChromeNeeded?: () => void;
}

/**
 * Settings tab page (stub until IMP-NAV-04 adds sections).
 */
export function SettingsPage({
  user: _user,
  linkedAccountsCredentials: _linkedAccountsCredentials,
  onTonWalletChromeNeeded: _onTonWalletChromeNeeded,
}: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">{t('nav.settings')}</h1>
    </div>
  );
}
