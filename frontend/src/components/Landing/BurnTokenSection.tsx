import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './BurnTokenSection.css';

const TOKENOMICS_URL =
  import.meta.env.VITE_TOKENOMICS_URL ||
  'https://github.com/Masalytin/BurnedChats/blob/master/docs/specs/TOKENOMICS.md';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function BurnTokenSection() {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const stats = [
    { value: '1,000', label: t('landing.burnToken.stat0') },
    { value: '0.5%', label: t('landing.burnToken.stat1') },
    { value: 'TON', label: t('landing.burnToken.stat2') },
    { value: '0.7%', label: t('landing.burnToken.stat3') },
  ];
  const feeSegments = [
    { key: 'burn', width: 0.5, label: t('landing.burnToken.seg0'), Icon: BurnIcon, tone: 'burn' },
    { key: 'staking', width: 0.3, label: t('landing.burnToken.seg1'), Icon: StakingIcon, tone: 'staking' },
    { key: 'treasury', width: 0.2, label: t('landing.burnToken.seg2'), Icon: TreasuryIcon, tone: 'treasury' },
  ];
  const utilityChips = [
    t('landing.burnToken.chip0'),
    t('landing.burnToken.chip1'),
    t('landing.burnToken.chip2'),
  ];

  const reveal = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: EASE_OUT },
    },
  };

  const stagger = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.05,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: EASE_OUT },
    },
  };

  return (
    <>
      <motion.div
        className="section-header"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.5 }}
        variants={reveal}
      >
        <h2 className="section-title">{t('landing.burnToken.title')}</h2>
        <p className="section-subtitle burn-token-hook">{t('landing.burnToken.hook')}</p>
      </motion.div>

      <motion.div
        className="burn-token-stats"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={stagger}
      >
        {stats.map((stat) => (
          <motion.div key={stat.label} className="burn-token-stat" variants={item}>
            <span className="burn-token-stat-value">{stat.value}</span>
            <span className="burn-token-stat-label">{stat.label}</span>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        className="burn-token-fee"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={reveal}
      >
        <p className="burn-token-fee-title">{t('landing.burnToken.feeTitle')}</p>

        <div className="burn-token-fee-bar" role="img" aria-label={t('landing.burnToken.feeAria')}>
          {feeSegments.map((segment) => (
            <div
              key={segment.key}
              className={`burn-token-fee-segment burn-token-fee-segment--${segment.tone}`}
              style={{ width: `${segment.width}%` }}
            />
          ))}
          <div className="burn-token-fee-segment burn-token-fee-segment--recipient" style={{ width: '99%' }} />
        </div>

        <ul className="burn-token-fee-legend">
          {feeSegments.map((segment) => (
            <li key={segment.key} className="burn-token-fee-legend-item">
              <segment.Icon />
              <span>{segment.label}</span>
            </li>
          ))}
          <li className="burn-token-fee-legend-item burn-token-fee-legend-item--recipient">
            <span>{t('landing.burnToken.recipient')}</span>
          </li>
        </ul>
      </motion.div>

      <motion.div
        className="burn-token-footer"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={stagger}
      >
        <div className="burn-token-chips">
          {utilityChips.map((chip) => (
            <motion.span key={chip} className="burn-token-chip" variants={item}>
              {chip}
            </motion.span>
          ))}
        </div>

        <motion.div className="burn-token-cta-row" variants={item}>
          <Link
            to="/token"
            className="burn-token-cta burn-token-cta--primary"
            aria-label={t('landing.burnToken.exploreAria')}
          >
            {t('landing.burnToken.explore')}
            <ArrowRightIcon />
          </Link>
          <a
            href={TOKENOMICS_URL}
            className="burn-token-cta"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('landing.burnToken.docsAria')}
          >
            {t('landing.burnToken.readDocs')}
            <ExternalLinkIcon />
          </a>
        </motion.div>
      </motion.div>
    </>
  );
}

function BurnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function StakingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  );
}

function TreasuryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
      <path d="M12 15v2" />
      <path d="M6 15v2" />
      <path d="M18 15v2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
