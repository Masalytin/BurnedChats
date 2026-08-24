import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import './OnboardingBriefing.css';

export interface OnboardingBriefingProps {
  onDismiss: () => void;
}

export function OnboardingBriefing({ onDismiss }: OnboardingBriefingProps) {
  const { t } = useTranslation();

  return (
    <div
      className="onboarding-briefing"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-briefing__card">
        <h2 id="onboarding-title" className="onboarding-briefing__title">
          {t('home.onboardingTitle')}
        </h2>
        <p className="onboarding-briefing__text">{t('home.onboardingKeys')}</p>
        <p className="onboarding-briefing__text">{t('home.onboardingInvite')}</p>
        <p className="onboarding-briefing__text">{t('home.onboardingRooms')}</p>
        <div className="onboarding-briefing__actions">
          <Button type="button" variant="primary" fullWidth onClick={onDismiss}>
            {t('home.onboardingContinue')}
          </Button>
        </div>
      </div>
    </div>
  );
}
