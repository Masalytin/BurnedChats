import { useTranslation } from 'react-i18next';
import {
  HeroSection,
  ManifestoSection,
  HowItWorksSection,
  TrustBlockSection,
  ComparisonSection,
  BurnTokenSection,
  TechSection,
  FooterSection,
} from '../../components/Landing';
import './LandingPage.css';

export function LandingPage() {
  const { t, i18n } = useTranslation();
  return (
    <div className="landing" lang={i18n.language}>
      <a href="#manifesto" className="visually-hidden">
        {t('landing.skip')}
      </a>

      <section className="landing-section hero" aria-label={t('landing.aria.hero')}>
        <HeroSection />
      </section>

      <section id="manifesto" className="landing-section landing-section--alt" aria-label={t('landing.aria.principles')}>
        <div className="landing-inner">
          <ManifestoSection />
        </div>
      </section>

      <section className="landing-section" aria-label={t('landing.aria.howItWorks')}>
        <div className="landing-inner">
          <HowItWorksSection />
        </div>
      </section>

      <section className="landing-section landing-section--alt" aria-label={t('landing.aria.trust')}>
        <div className="landing-inner">
          <TrustBlockSection />
        </div>
      </section>

      <section className="landing-section" aria-label={t('landing.aria.comparison')}>
        <div className="landing-inner">
          <ComparisonSection />
        </div>
      </section>

      <section className="landing-section landing-section--alt" aria-label={t('landing.aria.burnToken')}>
        <div className="landing-inner">
          <BurnTokenSection />
        </div>
      </section>

      <section className="landing-section" aria-label={t('landing.aria.tech')}>
        <div className="landing-inner">
          <TechSection />
        </div>
      </section>

      <section className="landing-section" aria-label={t('landing.aria.footer')}>
        <div className="landing-inner">
          <FooterSection />
        </div>
      </section>
    </div>
  );
}
