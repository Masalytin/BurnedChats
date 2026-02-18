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
      <main>
        <HeroSection />
        <ManifestoSection />
        <HowItWorksSection />
        <TrustBlockSection />
        <ComparisonSection />
        <TechSection />
        <FooterSection />
      </main>
    </div>
  );
}
