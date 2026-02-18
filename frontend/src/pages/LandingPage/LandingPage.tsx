import {
  HeroSection,
  ManifestoSection,
  HowItWorksSection,
  TrustBlockSection,
  ComparisonSection,
  TechSection,
  FooterSection,
} from '../../components/Landing';
import './LandingPage.css';

export function LandingPage() {
  return (
    <div className="landing" lang="en">
      <a href="#manifesto" className="visually-hidden">
        Skip to content
      </a>

      <section className="landing-section hero" aria-label="Hero">
        <HeroSection />
      </section>

      <section id="manifesto" className="landing-section landing-section--alt" aria-label="Our principles">
        <div className="landing-inner">
          <ManifestoSection />
        </div>
      </section>

      <section className="landing-section" aria-label="How it works">
        <div className="landing-inner">
          <HowItWorksSection />
        </div>
      </section>

      <section className="landing-section landing-section--alt" aria-label="Trust block">
        <div className="landing-inner">
          <TrustBlockSection />
        </div>
      </section>

      <section className="landing-section" aria-label="Comparison">
        <div className="landing-inner">
          <ComparisonSection />
        </div>
      </section>

      <section className="landing-section landing-section--alt" aria-label="Technology">
        <div className="landing-inner">
          <TechSection />
        </div>
      </section>

      <section className="landing-section" aria-label="Footer">
        <div className="landing-inner">
          <FooterSection />
        </div>
      </section>
    </div>
  );
}
