import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../auth/types';
import { AuthType } from '../auth/types';
import { Avatar, LanguageSwitcher } from '../components';
import { ExitDialog } from '../components/ExitDialog/ExitDialog';
import { useToast } from '../components/Toast';
import { AccountLinking } from '../components/Settings/AccountLinking';
import { LinkedAccounts, type LinkedAccountsCredentials } from '../components/Settings/LinkedAccounts';
import { burnAll } from '../crypto/keyStore';
import { useTelegram } from '../hooks/useTelegram';
import { usePreferences } from '../preferences';
import type { UserPreferences } from '../preferences';
import { shortenTonDisplayAddress } from '../ton/connector';
import '../components/Settings/LinkedAccounts.css';
import type { ExitBurnError } from '../hooks/useExitBurnFlow';
import '../components/ExitDialog/ExitDialog.css';
import './SettingsPage.css';

export interface SettingsExitApi {
  dialogOpen: boolean;
  isBurning: boolean;
  error: ExitBurnError | null;
  onOpenDialog: () => void;
  onCloseDialog: () => void;
  onJustExit: () => void;
  onBurnAndExit: () => void;
  onRetryBurnAndExit: () => void;
}

export interface SettingsPageProps {
  user: AuthUser | null;
  linkedAccountsCredentials: LinkedAccountsCredentials | null;
  onTonWalletChromeNeeded?: () => void;
  onBurnAllData?: () => void;
  onBurnAllAccount?: () => void;
  exit?: SettingsExitApi;
}

interface SettingsToggleProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SettingsToggle({ id, label, description, checked, onChange }: SettingsToggleProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <label className="settings-row__label" htmlFor={id}>
          {label}
        </label>
        {description ? <p className="settings-row__description">{description}</p> : null}
      </div>
      <label className="settings-toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="settings-toggle__input"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-toggle__track" aria-hidden="true" />
      </label>
    </div>
  );
}

interface ThemeOptionProps {
  id: string;
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}

function ThemeOption({ id, name, label, checked, onChange }: ThemeOptionProps) {
  return (
    <label className={`settings-theme-option${checked ? ' settings-theme-option--active' : ''}`} htmlFor={id}>
      <input
        id={id}
        type="radio"
        name={name}
        className="settings-theme-option__input"
        checked={checked}
        onChange={onChange}
      />
      <span className="settings-theme-option__label">{label}</span>
    </label>
  );
}

export function SettingsPage({
  user,
  linkedAccountsCredentials,
  onTonWalletChromeNeeded,
  onBurnAllData,
  onBurnAllAccount,
  exit,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { showConfirm } = useTelegram();
  const { prefs, setPref } = usePreferences();
  const [linkedRefresh, setLinkedRefresh] = useState(0);
  const [isClearingKeys, setIsClearingKeys] = useState(false);
  const displayName = user?.displayName ?? t('common.unknown');
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—';

  const handleClearLocalKeys = useCallback(async () => {
    const confirmed = await showConfirm(t('settings.security.clearKeysConfirm'));
    if (!confirmed) {
      return;
    }

    setIsClearingKeys(true);
    try {
      burnAll();
      toast.success(t('settings.security.clearKeysSuccess'));
    } finally {
      setIsClearingKeys(false);
    }
  }, [showConfirm, t, toast]);

  const handleThemeChange = useCallback(
    (themeMode: UserPreferences['themeMode']) => {
      setPref('themeMode', themeMode);
    },
    [setPref],
  );

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

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.appearance')}</h2>
        <div className="settings-section__card settings-appearance">
          <p className="settings-row__label">{t('settings.appearance.themeLabel')}</p>
          <div className="settings-theme-options" role="radiogroup" aria-label={t('settings.appearance.themeLabel')}>
            <ThemeOption
              id="settings-theme-telegram"
              name="settings-theme"
              label={t('settings.appearance.themeTelegram')}
              checked={prefs.themeMode === 'telegram'}
              onChange={() => handleThemeChange('telegram')}
            />
            <ThemeOption
              id="settings-theme-dark"
              name="settings-theme"
              label={t('settings.appearance.themeDark')}
              checked={prefs.themeMode === 'dark'}
              onChange={() => handleThemeChange('dark')}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.notifications')}</h2>
        <div className="settings-section__card settings-rows">
          <SettingsToggle
            id="settings-haptics"
            label={t('settings.notifications.haptics')}
            checked={prefs.hapticsEnabled}
            onChange={(checked) => setPref('hapticsEnabled', checked)}
          />
          <SettingsToggle
            id="settings-toasts"
            label={t('settings.notifications.toasts')}
            description={t('settings.notifications.toastsHint')}
            checked={prefs.toastsEnabled}
            onChange={(checked) => setPref('toastsEnabled', checked)}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.security')}</h2>
        <div className="settings-section__card settings-security">
          <p className="settings-security__hint">{t('settings.security.keysHint')}</p>
          <button
            type="button"
            className={`settings-security__button${isClearingKeys ? ' settings-security__button--loading' : ''}`}
            onClick={() => void handleClearLocalKeys()}
            disabled={isClearingKeys}
            aria-busy={isClearingKeys}
          >
            {isClearingKeys ? t('common.loading') : t('settings.security.clearKeys')}
          </button>
          <div className="settings-security__burn-all">
            <p className="settings-security__burn-all-label">{t('settings.burnAll.dataAction')}</p>
            <button
              type="button"
              className="settings-security__button settings-security__button--burn-all"
              onClick={onBurnAllData}
            >
              {t('settings.burnAll.dataAction')}
            </button>
            <p className="settings-security__burn-all-label settings-security__burn-all-label--account">
              {t('settings.burnAll.accountAction')}
            </p>
            <button
              type="button"
              className="settings-security__button settings-security__button--burn-all settings-security__button--account"
              onClick={onBurnAllAccount}
            >
              {t('settings.burnAll.accountAction')}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.developer')}</h2>
        <div className="settings-section__card settings-rows">
          <div className="settings-row settings-row--static">
            <div className="settings-row__text">
              <span className="settings-row__label">{t('settings.developer.version')}</span>
            </div>
            <span className="settings-row__value">{appVersion}</span>
          </div>
          <SettingsToggle
            id="settings-debug-panel"
            label={t('settings.developer.debugPanel')}
            checked={prefs.debugPanelEnabled}
            onChange={(checked) => setPref('debugPanelEnabled', checked)}
          />
        </div>
      </section>

      {exit ? (
        <section className="settings-section settings-exit">
          <button type="button" className="settings-exit__button" onClick={exit.onOpenDialog}>
            {t('settings.exit.button')}
          </button>
          <ExitDialog
            open={exit.dialogOpen}
            isBurning={exit.isBurning}
            error={exit.error}
            onClose={exit.onCloseDialog}
            onJustExit={exit.onJustExit}
            onBurnAndExit={exit.onBurnAndExit}
            onRetryBurnAndExit={exit.onRetryBurnAndExit}
          />
        </section>
      ) : null}
    </div>
  );
}
