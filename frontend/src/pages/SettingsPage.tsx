import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../auth/types';
import { AuthType } from '../auth/types';
import { Avatar, LanguageSwitcher } from '../components';
import { AccountLinking } from '../components/Settings/AccountLinking';
import { LinkedAccounts, type LinkedAccountsCredentials } from '../components/Settings/LinkedAccounts';
import { shortenTonDisplayAddress } from '../ton/connector';
import '../components/Settings/LinkedAccounts.css';
import './SettingsPage.css';

export interface SettingsPageProps {
  user: AuthUser | null;
  linkedAccountsCredentials: LinkedAccountsCredentials | null;
  onTonWalletChromeNeeded?: () => void;
}

export function SettingsPage({
  user,
  linkedAccountsCredentials,
  onTonWalletChromeNeeded,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const [linkedRefresh, setLinkedRefresh] = useState(0);
  const displayName = user?.displayName ?? t('common.unknown');

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">{t('settings.title')}</h1>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.profile')}</h2>
        <div className="settings-section__card settings-profile">
          <Avatar src={user?.avatarUrl} name={displayName} size="lg" />
          <div className="settings-profile__info">
            <p className="settings-profile__name">{displayName}</p>
            {user?.username ? (
              <p className="settings-profile__meta">@{user.username}</p>
            ) : null}
            {user?.authType === AuthType.WALLET && user.walletAddress ? (
              <p className="settings-profile__meta">
                {shortenTonDisplayAddress(user.walletAddress)}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.language')}</h2>
        <div className="settings-section__card settings-language">
          <span className="settings-language__label">{t('settings.languageLabel')}</span>
          <LanguageSwitcher />
        </div>
      </section>

      {linkedAccountsCredentials && user ? (
        <section className="settings-section">
          <h2 className="settings-section__header">{t('settings.section.accounts')}</h2>
          <p className="settings-section__subtitle">{t('accountLinking.sectionSubtitle')}</p>
          <div className="settings-section__card">
            <LinkedAccounts
              key={linkedRefresh}
              credentials={linkedAccountsCredentials}
              onChanged={() => setLinkedRefresh((key) => key + 1)}
              onTonWalletLinkedDetected={onTonWalletChromeNeeded}
            />
            <AccountLinking
              authType={user.authType}
              credentials={linkedAccountsCredentials}
              onLinked={() => setLinkedRefresh((key) => key + 1)}
              onBeforeTonWalletFlow={onTonWalletChromeNeeded}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
