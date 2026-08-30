import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../auth/types';
import { AuthType } from '../auth/types';
import { Avatar, LanguageSwitcher } from '../components';
import { ExitDialog } from '../components/ExitDialog/ExitDialog';
import { useToast } from '../components/Toast';
import { LinkedAccounts, type LinkedAccountsCredentials } from '../components/Settings/LinkedAccounts';
import { burnAll } from '../crypto/keyStore';
import { useTelegram, type HomeScreenStatus } from '../hooks/useTelegram';
import {
  DEADMAN_PERIOD_DAYS,
  DEFAULT_DEADMAN_PERIOD_DAYS,
  formatDeadmanExpiryDate,
  type DeadmanPeriodDays,
  type DeadmanState,
  type SetDeadmanRequest,
} from '../hooks/useDeadmanSwitch';
import { resetOnboardingProgress } from '../onboarding';
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

export interface SettingsDeadmanApi {
  deadman: DeadmanState | null;
  isConnected: boolean;
  onSetDeadman: (request: SetDeadmanRequest) => void;
}

export interface SettingsPageProps {
  user: AuthUser | null;
  linkedAccountsCredentials: LinkedAccountsCredentials | null;
  onTonWalletChromeNeeded?: () => void;
  onBurnAllData?: () => void;
  onBurnAllAccount?: () => void;
  exit?: SettingsExitApi;
  deadman?: SettingsDeadmanApi;
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

interface DeadmanPeriodOptionProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}

function DeadmanPeriodOption({ id, label, checked, onChange }: DeadmanPeriodOptionProps) {
  return (
    <label
      className={`settings-deadman__period${checked ? ' settings-deadman__period--active' : ''}`}
      htmlFor={id}
    >
      <input
        id={id}
        type="radio"
        name="settings-deadman-period"
        className="settings-deadman__period-input"
        checked={checked}
        onChange={onChange}
      />
      <span className="settings-deadman__period-label">{label}</span>
    </label>
  );
}

function deadmanPeriodLabelKey(days: DeadmanPeriodDays): string {
  if (days === 7) return 'settings.deadman.period7';
  if (days === 90) return 'settings.deadman.period90';
  return 'settings.deadman.period30';
}

export function SettingsPage({
  user,
  linkedAccountsCredentials,
  onTonWalletChromeNeeded,
  onBurnAllData,
  onBurnAllAccount,
  exit,
  deadman,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { showConfirm, addToHomeScreen, checkHomeScreenStatus } = useTelegram();
  const { prefs, setPref } = usePreferences();
  const [isClearingKeys, setIsClearingKeys] = useState(false);
  const [homeScreenStatus, setHomeScreenStatus] = useState<HomeScreenStatus | null>(null);
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<DeadmanPeriodDays>(
    DEFAULT_DEADMAN_PERIOD_DAYS,
  );
  const [wipeIdentity, setWipeIdentity] = useState(false);
  const displayName = user?.displayName ?? t('common.unknown');
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—';

  const deadmanEnabled = deadman?.deadman?.enabled ?? false;
  const activePeriodDays = deadmanEnabled
    ? deadman?.deadman?.periodDays ?? selectedPeriodDays
    : selectedPeriodDays;
  const activeWipeIdentity = deadmanEnabled
    ? deadman?.deadman?.wipeIdentity ?? wipeIdentity
    : wipeIdentity;

  useEffect(() => {
    if (deadman?.deadman?.periodDays != null) {
      setSelectedPeriodDays(deadman.deadman.periodDays);
    }
    if (deadman?.deadman != null) {
      setWipeIdentity(deadman.deadman.wipeIdentity);
    }
  }, [deadman?.deadman?.periodDays, deadman?.deadman?.wipeIdentity, deadman?.deadman]);

  useEffect(() => {
    let cancelled = false;
    void checkHomeScreenStatus().then((status) => {
      if (!cancelled) {
        setHomeScreenStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [checkHomeScreenStatus]);

  const showHomeScreenRow =
    homeScreenStatus === 'missed' || homeScreenStatus === 'unknown';

  const handleAddToHomeScreen = useCallback(() => {
    addToHomeScreen();
    void checkHomeScreenStatus().then(setHomeScreenStatus);
  }, [addToHomeScreen, checkHomeScreenStatus]);

  const buildDeadmanRequest = useCallback(
    (overrides: Partial<SetDeadmanRequest> & Pick<SetDeadmanRequest, 'enabled'>): SetDeadmanRequest => ({
      enabled: overrides.enabled,
      periodDays: overrides.periodDays ?? activePeriodDays,
      wipeIdentity: overrides.wipeIdentity ?? activeWipeIdentity,
    }),
    [activePeriodDays, activeWipeIdentity],
  );

  const applyDeadmanRequest = useCallback(
    (request: SetDeadmanRequest) => {
      if (!deadman?.isConnected) {
        toast.error(t('settings.deadman.offlineError'));
        return;
      }
      deadman.onSetDeadman(request);
    },
    [deadman, t, toast],
  );

  const handleDeadmanToggle = useCallback(
    async (checked: boolean) => {
      if (!deadman) {
        return;
      }

      if (!checked) {
        applyDeadmanRequest(buildDeadmanRequest({ enabled: false }));
        return;
      }

      const confirmed = await showConfirm(t('settings.deadman.enableConfirm'));
      if (!confirmed) {
        return;
      }

      applyDeadmanRequest(
        buildDeadmanRequest({
          enabled: true,
          periodDays: selectedPeriodDays,
          wipeIdentity,
        }),
      );
    },
    [
      applyDeadmanRequest,
      buildDeadmanRequest,
      deadman,
      selectedPeriodDays,
      showConfirm,
      t,
      wipeIdentity,
    ],
  );

  const handleDeadmanPeriodChange = useCallback(
    (periodDays: DeadmanPeriodDays) => {
      setSelectedPeriodDays(periodDays);
      if (!deadmanEnabled) {
        return;
      }
      applyDeadmanRequest(buildDeadmanRequest({ enabled: true, periodDays }));
    },
    [applyDeadmanRequest, buildDeadmanRequest, deadmanEnabled],
  );

  const handleDeadmanWipeIdentityChange = useCallback(
    (checked: boolean) => {
      setWipeIdentity(checked);
      if (!deadmanEnabled) {
        return;
      }
      applyDeadmanRequest(buildDeadmanRequest({ enabled: true, wipeIdentity: checked }));
    },
    [applyDeadmanRequest, buildDeadmanRequest, deadmanEnabled],
  );

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

  const handleReplayOnboarding = useCallback(async () => {
    const confirmed = await showConfirm(t('settings.onboardingReplay.confirm'));
    if (!confirmed) {
      return;
    }

    resetOnboardingProgress();
    navigate('/app');
  }, [navigate, showConfirm, t]);

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
              credentials={linkedAccountsCredentials}
              authType={user.authType}
              onTonWalletLinkedDetected={onTonWalletChromeNeeded}
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
              checked={prefs.themeMode === 'ember'}
              onChange={() => handleThemeChange('ember')}
            />
          </div>
        </div>
        {showHomeScreenRow ? (
          <div className="settings-section__card settings-rows">
            <button
              type="button"
              className="settings-row"
              onClick={handleAddToHomeScreen}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'start',
                color: 'inherit',
              }}
            >
              <div className="settings-row__text">
                <span className="settings-row__label">{t('settings.homeScreen.add')}</span>
                <p className="settings-row__description">{t('settings.homeScreen.addHint')}</p>
              </div>
            </button>
          </div>
        ) : null}
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
        <h2 className="settings-section__header">{t('settings.section.learn')}</h2>
        <div className="settings-section__card settings-rows">
          <button
            type="button"
            className="settings-row"
            onClick={() => void handleReplayOnboarding()}
            aria-label={t('settings.onboardingReplay.action')}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'start',
              color: 'inherit',
            }}
          >
            <div className="settings-row__text">
              <span className="settings-row__label">{t('settings.onboardingReplay.action')}</span>
              <p className="settings-row__description">{t('settings.onboardingReplay.hint')}</p>
            </div>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__header">{t('settings.section.security')}</h2>
        <div className="settings-section__card settings-security">
          <SettingsToggle
            id="settings-panic-gesture"
            label={t('panic.toggle')}
            description={t('panic.toggleHint')}
            checked={prefs.panicGestureEnabled}
            onChange={(checked) => setPref('panicGestureEnabled', checked)}
          />
          <p className="settings-security__hint">{t('settings.security.keysHint')}</p>
          {deadman ? (
            <div className="settings-deadman">
              <p className="settings-deadman__title">{t('settings.deadman.title')}</p>
              <p className="settings-deadman__description">{t('settings.deadman.description')}</p>
              <SettingsToggle
                id="settings-deadman-enabled"
                label={t('settings.deadman.toggle')}
                checked={deadmanEnabled}
                onChange={(checked) => void handleDeadmanToggle(checked)}
              />
              <div className="settings-deadman__options">
                <p className="settings-row__label">{t('settings.deadman.periodLabel')}</p>
                <div
                  className="settings-deadman__periods"
                  role="radiogroup"
                  aria-label={t('settings.deadman.periodLabel')}
                >
                  {DEADMAN_PERIOD_DAYS.map((days) => (
                    <DeadmanPeriodOption
                      key={days}
                      id={`settings-deadman-period-${days}`}
                      label={t(deadmanPeriodLabelKey(days))}
                      checked={activePeriodDays === days}
                      onChange={() => handleDeadmanPeriodChange(days)}
                    />
                  ))}
                </div>
                <SettingsToggle
                  id="settings-deadman-wipe-identity"
                  label={t('settings.deadman.wipeIdentity')}
                  description={t('settings.deadman.wipeIdentityHint')}
                  checked={activeWipeIdentity}
                  onChange={handleDeadmanWipeIdentityChange}
                />
              </div>
              {deadmanEnabled && deadman.deadman?.expiresAt != null ? (
                <p className="settings-deadman__status">
                  {t('settings.deadman.status', {
                    date: formatDeadmanExpiryDate(deadman.deadman.expiresAt, i18n.language),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="settings-security__burn-all">
            <p className="settings-security__burn-all-label">{t('settings.security.clearKeys')}</p>
            <button
              type="button"
              className={`settings-security__button settings-security__button--burn-all${isClearingKeys ? ' settings-security__button--loading' : ''}`}
              onClick={() => void handleClearLocalKeys()}
              disabled={isClearingKeys}
              aria-busy={isClearingKeys}
            >
              {isClearingKeys ? t('common.loading') : t('settings.security.clearKeys')}
            </button>
            <p className="settings-security__burn-all-label settings-security__burn-all-label--account">
              {t('settings.burnAll.dataAction')}
            </p>
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
