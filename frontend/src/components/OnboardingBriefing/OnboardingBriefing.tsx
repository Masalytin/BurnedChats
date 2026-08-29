import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import './OnboardingBriefing.css';

export interface OnboardingBriefingProps {
  onDismiss: () => void;
}

type BriefingStep = 'briefing' | 'keys' | 'burn';

interface QuizChoice {
  key: 'keysWrong' | 'keysRight' | 'burnWrong' | 'burnRight';
  correct: boolean;
}

/** Q1 wrong-first, Q2 right-first — the correct answer is not always last. */
const KEYS_CHOICES: QuizChoice[] = [
  { key: 'keysWrong', correct: false },
  { key: 'keysRight', correct: true },
];

const BURN_CHOICES: QuizChoice[] = [
  { key: 'burnRight', correct: true },
  { key: 'burnWrong', correct: false },
];

export function OnboardingBriefing({ onDismiss }: OnboardingBriefingProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<BriefingStep>('briefing');
  const [showHint, setShowHint] = useState(false);

  const isQuiz = step !== 'briefing';
  const choices = step === 'burn' ? BURN_CHOICES : KEYS_CHOICES;
  const questionKey = step === 'burn' ? 'burnQuestion' : 'keysQuestion';
  const hintKey = step === 'burn' ? 'burnHint' : 'keysHint';

  const handleChoice = (correct: boolean) => {
    if (!correct) {
      setShowHint(true);
      return;
    }
    setShowHint(false);
    if (step === 'keys') {
      setStep('burn');
      return;
    }
    onDismiss();
  };

  return (
    <div
      className="onboarding-briefing"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-briefing__card">
        {isQuiz ? (
          <>
            <h2 id="onboarding-title" className="onboarding-briefing__title">
              {t('home.onboardingQuiz.title')}
            </h2>
            <p className="onboarding-briefing__text">{t(`home.onboardingQuiz.${questionKey}`)}</p>
            <div className="onboarding-briefing__choices">
              {choices.map((choice) => (
                <Button
                  key={choice.key}
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={() => handleChoice(choice.correct)}
                >
                  {t(`home.onboardingQuiz.${choice.key}`)}
                </Button>
              ))}
            </div>
            {showHint ? (
              <p className="onboarding-briefing__hint" role="status">
                {t(`home.onboardingQuiz.${hintKey}`)}
              </p>
            ) : null}
            <div className="onboarding-briefing__actions">
              <Button type="button" variant="ghost" fullWidth onClick={onDismiss}>
                {t('home.onboardingQuiz.skip')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="onboarding-title" className="onboarding-briefing__title">
              {t('home.onboardingTitle')}
            </h2>
            <p className="onboarding-briefing__text">{t('home.onboardingKeys')}</p>
            <p className="onboarding-briefing__text">{t('home.onboardingInvite')}</p>
            <p className="onboarding-briefing__text">{t('home.onboardingRooms')}</p>
            <div className="onboarding-briefing__actions">
              <Button type="button" variant="primary" fullWidth onClick={() => setStep('keys')}>
                {t('home.onboardingContinue')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
