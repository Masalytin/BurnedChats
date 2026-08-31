import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useBackButton } from '../../hooks/useBackButton';
import { writeTextToClipboard } from '../../utils/clipboard';
import './TokenPage.css';

const WALLET_FROM = 'wallet';
const WALLET_BACK_TO = '/app/wallet';
const HOME_BACK_TO = '/';

function resolveTokenPageBack(from: string | null, t: TFunction) {
  if (from === WALLET_FROM) {
    return {
      to: WALLET_BACK_TO,
      topLabel: t('tokenPage.backWallet'),
      footerLabel: t('tokenPage.backWallet'),
      aria: t('tokenPage.backWallet'),
      fromWallet: true,
    };
  }
  return {
    to: HOME_BACK_TO,
    topLabel: t('tokenPage.backHomeLabel'),
    footerLabel: t('tokenPage.backHomeFooter'),
    aria: t('tokenPage.backHomeAria'),
    fromWallet: false,
  };
}

const TOKENOMICS_URL =
  import.meta.env.VITE_TOKENOMICS_URL ||
  'https://github.com/Masalytin/BurnedChats/blob/master/docs/specs/TOKENOMICS.md';

const TON_NETWORK = import.meta.env.VITE_TON_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
const EXPLORER_BASE =
  TON_NETWORK === 'testnet' ? 'https://testnet.tonviewer.com/' : 'https://tonviewer.com/';

/** Canonical TON mainnet addresses from contracts/deployments/mainnet.json (2026-08-23). */
const MAINNET = {
  jettonMaster: 'EQB_BXje-o9PaFNkeenhq47MTUHXOEXCCqm_WTISgwKk8sPa',
  stakingMaster: 'EQAStcNFaLaHJ9YtUI-Nyq-EwKj4DA6xOhfBpvtLIxZog6Mv',
  stakingPool: 'EQByqimQJwEjTZZV-mYY46Qmhy8-dxSm6WCh_4XViykf-JL6',
  governor: 'EQDg8eru-72BQ-F3-CT1cFPJD_olGZp3CWaUExd_lekbA90f',
  treasury: 'EQBVUSLX2gSL0_ixhi950GO1XLPRSoeB1655TsymZHIh-2WB',
  airdropHolder: 'EQD5iBzYOb6vVZ-0TDksbFhffe7EUdvIHl_6ou6DAI4Km-9D',
  liquidityHolder: 'EQDJ_T4KvEFY9mnAzQy8aVgoa-oJyLvG1EnM2PMSsu5k7lu5',
  vestingEcosystem: 'EQCCdHDOjCyUwnFi5XKUwftj706D0PRx8R5GwURX2z8vVTee',
  vestingReserve: 'EQB3HgdoNOtZZQOLYfQ8KqycGuKLUW8Y2pKbqNEOWi62vTKb',
  vestingDeveloper: 'EQDfRFvoWfeNQt3p2euqfrNn0seJNUXwObAAym4MF8k5JSQW',
} as const;

const JETTON_MASTER = import.meta.env.VITE_BURN_JETTON_MASTER || MAINNET.jettonMaster;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function truncateAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

export function TokenPage() {
  const { t, i18n } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const back = resolveTokenPageBack(searchParams.get('from'), t);

  const stats = [
    { value: '1,000', label: t('tokenPage.stat0') },
    { value: 'TEP-74', label: t('tokenPage.stat1') },
    { value: '9', label: t('tokenPage.stat2') },
    { value: '1%', label: t('tokenPage.stat3') },
    { value: '0.5%', label: t('tokenPage.stat4') },
    { value: '0.7%', label: t('tokenPage.stat5') },
  ];
  const feeSegments = [
    { key: 'burn', width: 0.5, label: t('tokenPage.seg0'), tone: 'burn' },
    { key: 'staking', width: 0.3, label: t('tokenPage.seg1'), tone: 'staking' },
    { key: 'treasury', width: 0.2, label: t('tokenPage.seg2'), tone: 'treasury' },
  ];
  const allocations = [
    { label: t('tokenPage.alloc0'), amount: '200 BURN', percent: 20, note: t('tokenPage.alloc0Note'), address: MAINNET.airdropHolder },
    { label: t('tokenPage.alloc1'), amount: '300 BURN', percent: 30, note: t('tokenPage.alloc1Note'), address: MAINNET.stakingPool },
    { label: t('tokenPage.alloc2'), amount: '300 BURN', percent: 30, note: t('tokenPage.alloc2Note'), address: MAINNET.liquidityHolder },
    { label: t('tokenPage.alloc3'), amount: '150 BURN', percent: 15, note: t('tokenPage.alloc3Note'), address: MAINNET.vestingEcosystem },
    { label: t('tokenPage.alloc4'), amount: '43 BURN', percent: 4.3, note: t('tokenPage.alloc4Note'), address: MAINNET.vestingReserve },
    { label: t('tokenPage.alloc5'), amount: '7 BURN', percent: 0.7, note: t('tokenPage.alloc5Note'), address: MAINNET.vestingDeveloper },
  ];
  const tiers = [
    { name: t('tokenPage.tier0'), lock: t('tokenPage.tier0Lock'), share: '5%', vp: '1.0x', extras: t('tokenPage.tier0Extra') },
    { name: t('tokenPage.tier1'), lock: t('tokenPage.tier1Lock'), share: '10%', vp: '1.5x', extras: null },
    { name: t('tokenPage.tier2'), lock: t('tokenPage.tier2Lock'), share: '25%', vp: '2.0x', extras: null },
    { name: t('tokenPage.tier3'), lock: t('tokenPage.tier3Lock'), share: '60%', vp: '3.0x', extras: t('tokenPage.tier3Extra') },
  ];
  const proposals = [
    { type: t('tokenPage.prop0'), quorum: '10% VP', approval: '51%', period: t('tokenPage.period3d') },
    { type: t('tokenPage.prop1'), quorum: '5% VP', approval: '51%', period: t('tokenPage.period7d') },
    { type: t('tokenPage.prop2'), quorum: '20% VP', approval: '66%', period: t('tokenPage.period7d') },
    { type: t('tokenPage.prop3'), quorum: '30% VP', approval: '75%', period: t('tokenPage.period24h') },
  ];
  const utilities = [
    { title: t('tokenPage.util0Title'), body: t('tokenPage.util0Body'), Icon: GiftIcon },
    { title: t('tokenPage.util1Title'), body: t('tokenPage.util1Body'), Icon: VoteIcon },
    { title: t('tokenPage.util2Title'), body: t('tokenPage.util2Body'), Icon: CoinsIcon },
    { title: t('tokenPage.util3Title'), body: t('tokenPage.util3Body'), Icon: SparkleIcon },
  ];
  const contractAddresses = [
    { label: t('tokenPage.jettonMaster'), address: JETTON_MASTER },
    { label: t('tokenPage.stakingMaster'), address: import.meta.env.VITE_STAKING_MASTER || MAINNET.stakingMaster },
    { label: t('tokenPage.governor'), address: import.meta.env.VITE_GOVERNOR_ADDRESS || MAINNET.governor },
    { label: t('tokenPage.treasury'), address: import.meta.env.VITE_TREASURY_ADDRESS || MAINNET.treasury },
  ];

  useBackButton({
    visible: back.fromWallet,
    onBack: back.fromWallet ? () => navigate(WALLET_BACK_TO) : undefined,
  });

  const reveal = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
  };

  const stagger = {
    hidden: {},
    visible: { transition: { staggerChildren: prefersReducedMotion ? 0 : 0.05 } },
  };

  const item = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
  };

  return (
    <div className="token-page" lang={i18n.language}>
      <header className="tp-topbar">
        <Link to={back.to} className="tp-back" aria-label={back.aria}>
          <FlameIcon />
          {back.topLabel}
        </Link>
      </header>

      {/* 1. Hero */}
      <section className="tp-section tp-hero" aria-label={t('tokenPage.aria.hero')}>
        <div className="tp-inner">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1 className="tp-hero-title" variants={item}>
              {t('tokenPage.heroTitle')}
            </motion.h1>
            <motion.p className="tp-hero-hook" variants={item}>
              {t('tokenPage.heroHook')}
            </motion.p>
            <motion.p className="tp-hero-lede" variants={item}>
              {t('tokenPage.heroLede')}
            </motion.p>
            <motion.div className="tp-hero-status" variants={item}>
              <span className="tp-status-pill">
                <span className="tp-status-dot" aria-hidden="true" />
                {t('tokenPage.contractsLive', { network: TON_NETWORK })}
              </span>
              <JettonMasterCard address={JETTON_MASTER} />
              <span className="tp-status-note">
                {t('tokenPage.verifyNote')}
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* 2. Philosophy */}
      <section className="tp-section tp-section--alt" aria-label={t('tokenPage.aria.philosophy')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.philosophyTitle')}</h2>
          </motion.div>
          <motion.div
            className="tp-philosophy"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            <motion.p className="tp-philosophy-line" variants={item}>
              {t('tokenPage.phil1')}
            </motion.p>
            <motion.p className="tp-philosophy-line" variants={item}>
              {t('tokenPage.phil2')}
            </motion.p>
            <motion.blockquote className="tp-philosophy-quote" variants={item}>
              {t('tokenPage.philQuote')}
            </motion.blockquote>
            <motion.p className="tp-philosophy-body" variants={item}>
              {t('tokenPage.philBody')}
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* 3. Key parameters */}
      <section className="tp-section" aria-label={t('tokenPage.aria.params')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.paramsTitle')}</h2>
          </motion.div>
          <motion.div
            className="tp-stats"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            {stats.map((stat) => (
              <motion.div key={stat.label} className="tp-stat" variants={item}>
                <span className="tp-stat-value">{stat.value}</span>
                <span className="tp-stat-label">{stat.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* 4. Deflationary mechanism */}
      <section className="tp-section tp-section--alt" aria-label={t('tokenPage.aria.fee')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.feeTitle')}</h2>
          </motion.div>

          <motion.div
            className="tp-fee"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={reveal}
          >
            <div
              className="tp-fee-bar"
              role="img"
              aria-label={t('tokenPage.feeAria')}
            >
              {feeSegments.map((segment) => (
                <div
                  key={segment.key}
                  className={`tp-fee-segment tp-fee-segment--${segment.tone}`}
                  style={{ width: `${segment.width}%` }}
                />
              ))}
              <div className="tp-fee-segment tp-fee-segment--recipient" style={{ width: '99%' }} />
            </div>
            <ul className="tp-fee-legend">
              {feeSegments.map((segment) => (
                <li key={segment.key} className={`tp-fee-legend-item tp-fee-legend-item--${segment.tone}`}>
                  <span className="tp-fee-swatch" aria-hidden="true" />
                  {segment.label}
                </li>
              ))}
              <li className="tp-fee-legend-item tp-fee-legend-item--recipient">
                <span className="tp-fee-swatch" aria-hidden="true" />
                {t('tokenPage.recipient')}
              </li>
            </ul>
          </motion.div>

          <motion.div
            className="tp-card-row"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            <motion.div className="tp-card" variants={item}>
              <h3 className="tp-card-title">{t('tokenPage.dynamicTitle')}</h3>
              <p className="tp-card-body">
                {t('tokenPage.dynamicBody')}
              </p>
            </motion.div>
            <motion.div className="tp-card" variants={item}>
              <h3 className="tp-card-title">{t('tokenPage.floorTitle')}</h3>
              <p className="tp-card-body">
                {t('tokenPage.floorBody')}
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* 5. Emission distribution */}
      <section className="tp-section" aria-label={t('tokenPage.aria.allocation')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.allocTitle')}</h2>
            <p className="tp-section-subtitle">
              {t('tokenPage.allocSubtitle')}
            </p>
          </motion.div>
          <motion.ul
            className="tp-allocations"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            {allocations.map((row) => (
              <motion.li key={row.label} className="tp-allocation" variants={item}>
                <div className="tp-allocation-head">
                  <span className="tp-allocation-label">{row.label}</span>
                  <span className="tp-allocation-amount">
                    {row.amount} · {row.percent}%
                  </span>
                </div>
                <div className="tp-allocation-track" aria-hidden="true">
                  <div className="tp-allocation-fill" style={{ width: `${row.percent}%` }} />
                </div>
                <p className="tp-allocation-note">{row.note}</p>
                <ExplorerAddress address={row.address} label={t('tokenPage.holderAria', { label: row.label })} />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* 6. Staking */}
      <section className="tp-section tp-section--alt" aria-label={t('tokenPage.aria.staking')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.stakingTitle')}</h2>
            <p className="tp-section-subtitle">
              {t('tokenPage.stakingSubtitle')}
            </p>
          </motion.div>
          <motion.div
            className="tp-tiers"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            {tiers.map((tier) => (
              <motion.div key={tier.name} className="tp-tier" variants={item}>
                <h3 className="tp-tier-name">{tier.name}</h3>
                <span className="tp-tier-lock">{tier.lock}</span>
                <dl className="tp-tier-facts">
                  <div className="tp-tier-fact">
                    <dt>{t('tokenPage.rewardShare')}</dt>
                    <dd>{tier.share}</dd>
                  </div>
                  <div className="tp-tier-fact">
                    <dt>{t('tokenPage.votingPower')}</dt>
                    <dd>{tier.vp}</dd>
                  </div>
                </dl>
                {tier.extras && <span className="tp-tier-extras">{tier.extras}</span>}
              </motion.div>
            ))}
          </motion.div>
          <motion.p
            className="tp-staking-note"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            {t('tokenPage.stakingNote')}
          </motion.p>
        </div>
      </section>

      {/* 7. Governance */}
      <section className="tp-section" aria-label={t('tokenPage.aria.governance')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.govTitle')}</h2>
            <p className="tp-section-subtitle">
              {t('tokenPage.govSubtitle')}
            </p>
          </motion.div>

          <motion.p
            className="tp-gov-formula"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            {t('tokenPage.govFormula')}
          </motion.p>

          <motion.div
            className="tp-gov-table-wrapper"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={reveal}
          >
            <table className="tp-gov-table">
              <caption>{t('tokenPage.govCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('tokenPage.colType')}</th>
                  <th scope="col">{t('tokenPage.colQuorum')}</th>
                  <th scope="col">{t('tokenPage.colApproval')}</th>
                  <th scope="col">{t('tokenPage.colPeriod')}</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.type}>
                    <td>{p.type}</td>
                    <td>{p.quorum}</td>
                    <td>{p.approval}</td>
                    <td>{p.period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          <motion.p
            className="tp-gov-params"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            {t('tokenPage.govParams')}
          </motion.p>
        </div>
      </section>

      {/* 8. Utility */}
      <section className="tp-section tp-section--alt" aria-label={t('tokenPage.aria.utility')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.utilTitle')}</h2>
          </motion.div>
          <motion.div
            className="tp-utilities"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            {utilities.map((u) => (
              <motion.div key={u.title} className="tp-card tp-utility" variants={item}>
                <span className="tp-utility-icon" aria-hidden="true">
                  <u.Icon />
                </span>
                <h3 className="tp-card-title">{u.title}</h3>
                <p className="tp-card-body">{u.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* 9. On-chain */}
      <section className="tp-section" aria-label={t('tokenPage.aria.contracts')}>
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">{t('tokenPage.contractsTitle')}</h2>
            <p className="tp-section-subtitle">
              {t('tokenPage.contractsSubtitle')}
            </p>
          </motion.div>
          <motion.div
            className="tp-onchain"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            <motion.div className="tp-onchain-row" variants={item}>
              <span className="tp-onchain-label">{t('tokenPage.network')}</span>
              <span className="tp-onchain-value">{t('tokenPage.networkValue', { network: TON_NETWORK })}</span>
            </motion.div>
            {contractAddresses.map((row) => (
              <motion.div key={row.label} className="tp-onchain-row" variants={item}>
                <span className="tp-onchain-label">{row.label}</span>
                <ExplorerAddress address={row.address} label={row.label} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* 10. Footer */}
      <footer className="tp-section tp-section--alt tp-footer" aria-label={t('tokenPage.aria.footer')}>
        <div className="tp-inner">
          <div className="tp-footer-ctas">
            <a
              href={TOKENOMICS_URL}
              className="tp-cta tp-cta--primary"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('tokenPage.readTokenomicsAria')}
            >
              {t('tokenPage.readTokenomics')}
              <ExternalLinkIcon />
            </a>
            <Link to={back.to} className="tp-cta">
              {back.footerLabel}
            </Link>
          </div>
          <p className="tp-footer-disclaimer">
            {t('tokenPage.disclaimer')}
          </p>
        </div>
      </footer>
    </div>
  );
}

function explorerHref(address: string): string {
  return `${EXPLORER_BASE}${address}`;
}

function ExplorerAddress({ address, label }: { address: string; label: string }) {
  const { t } = useTranslation();
  return (
    <a
      className="tp-addr"
      href={explorerHref(address)}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      aria-label={t('tokenPage.explorerAria', { label, address })}
    >
      {truncateAddress(address)}
      <ExternalLinkIcon />
    </a>
  );
}

function JettonMasterCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    const ok = await writeTextToClipboard(address);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="tp-hero-jetton">
      <span className="tp-hero-jetton-label">{t('tokenPage.jettonMaster')}</span>
      <div className="tp-hero-jetton-row">
        <a
          className="tp-hero-jetton-addr"
          href={explorerHref(address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('tokenPage.jettonAria', { address })}
        >
          {address}
          <ExternalLinkIcon />
        </a>
        <button
          type="button"
          className="tp-copy"
          onClick={() => void copyAddress()}
          aria-label={copied ? t('tokenPage.copiedAria') : t('tokenPage.copyAria')}
        >
          {copied ? <CheckIcon /> : <CopyGlyph />}
          <span>{copied ? t('tokenPage.copied') : t('tokenPage.copy')}</span>
        </button>
      </div>
    </div>
  );
}

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function VoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 12 2 2 4-4" />
      <path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7z" />
      <path d="M22 19H2" />
    </svg>
  );
}

function CoinsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
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
