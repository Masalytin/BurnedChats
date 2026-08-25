import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { writeTextToClipboard } from '../../utils/clipboard';
import './TokenPage.css';

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

const stats = [
  { value: '1,000', label: 'Max supply' },
  { value: 'TEP-74', label: 'Jetton on TON' },
  { value: '9', label: 'Decimals' },
  { value: '1%', label: 'Total transfer fee' },
  { value: '0.5%', label: 'Burned per transfer' },
  { value: '0.7%', label: 'Dev allocation · 12-mo vesting' },
] as const;

const feeSegments = [
  { key: 'burn', width: 0.5, label: '0.5% burned forever', tone: 'burn' },
  { key: 'staking', width: 0.3, label: '0.3% to staking pool', tone: 'staking' },
  { key: 'treasury', width: 0.2, label: '0.2% to treasury', tone: 'treasury' },
] as const;

const allocations = [
  { label: 'Community Airdrop', amount: '200 BURN', percent: 20, note: 'Early Burned Chats users', address: MAINNET.airdropHolder },
  { label: 'Staking Rewards', amount: '300 BURN', percent: 30, note: 'Released linearly over 3 years, enforced on-chain', address: MAINNET.stakingPool },
  { label: 'Liquidity Pool', amount: '300 BURN', percent: 30, note: 'Held for DEX pools, gated by governance', address: MAINNET.liquidityHolder },
  { label: 'Ecosystem', amount: '150 BURN', percent: 15, note: 'Grants & partnerships, 2-year vesting', address: MAINNET.vestingEcosystem },
  { label: 'Reserve', amount: '43 BURN', percent: 4.3, note: 'Locked for 3 years', address: MAINNET.vestingReserve },
  { label: 'Developer', amount: '7 BURN', percent: 0.7, note: '12-month linear vesting — no rug pull by design', address: MAINNET.vestingDeveloper },
] as const;

const tiers = [
  { name: 'Flexible', lock: 'No lock', share: '5%', vp: '1.0x', extras: 'Instant unstake' },
  { name: 'Silver', lock: '6 months', share: '10%', vp: '1.5x', extras: null },
  { name: 'Gold', lock: '1 year', share: '25%', vp: '2.0x', extras: null },
  { name: 'Diamond', lock: '3 years', share: '60%', vp: '3.0x', extras: 'NFT badge · beta access' },
] as const;

const proposals = [
  { type: 'Parameter Change', quorum: '10% VP', approval: '51%', period: '3 days' },
  { type: 'Feature Priority', quorum: '5% VP', approval: '51%', period: '7 days' },
  { type: 'Treasury Spend', quorum: '20% VP', approval: '66%', period: '7 days' },
  { type: 'Emergency', quorum: '30% VP', approval: '75%', period: '24 hours' },
] as const;

const utilities = [
  { title: 'Rewards', body: 'Airdrops, referral and community incentives for early Burned Chats users.', Icon: GiftIcon },
  { title: 'Governance', body: 'Vote on parameters, features and treasury spending.', Icon: VoteIcon },
  { title: 'Staking', body: 'Stake for pool rewards, voting power and Diamond-tier perks.', Icon: CoinsIcon },
  { title: 'Status', body: 'Cosmetic upgrades: avatar frames, burn effects, OG holder status.', Icon: SparkleIcon },
] as const;

const contractAddresses = [
  { label: 'Jetton Master', address: JETTON_MASTER },
  { label: 'Staking Master', address: import.meta.env.VITE_STAKING_MASTER || MAINNET.stakingMaster },
  { label: 'Governor', address: import.meta.env.VITE_GOVERNOR_ADDRESS || MAINNET.governor },
  { label: 'Treasury', address: import.meta.env.VITE_TREASURY_ADDRESS || MAINNET.treasury },
];

function truncateAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

export function TokenPage() {
  const prefersReducedMotion = useReducedMotion();

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
    <div className="token-page" lang="en">
      <header className="tp-topbar">
        <Link to="/" className="tp-back" aria-label="Back to Burned Chats home">
          <FlameIcon />
          Burned Chats
        </Link>
      </header>

      {/* 1. Hero */}
      <section className="tp-section tp-hero" aria-label="BURN token overview">
        <div className="tp-inner">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1 className="tp-hero-title" variants={item}>
              The BURN Token
            </motion.h1>
            <motion.p className="tp-hero-hook" variants={item}>
              Messages burn. So does the token.
            </motion.p>
            <motion.p className="tp-hero-lede" variants={item}>
              A deflationary Jetton on TON built into Burned Chats. Every transfer burns supply,
              funds staking rewards, and fills a community-governed treasury.
            </motion.p>
            <motion.div className="tp-hero-status" variants={item}>
              <span className="tp-status-pill">
                <span className="tp-status-dot" aria-hidden="true" />
                Contracts live on TON {TON_NETWORK}
              </span>
              <JettonMasterCard address={JETTON_MASTER} />
              <span className="tp-status-note">
                Always verify contract addresses below before interacting.
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* 2. Philosophy */}
      <section className="tp-section tp-section--alt" aria-label="Why a token that burns">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Why a token that burns</h2>
          </motion.div>
          <motion.div
            className="tp-philosophy"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            <motion.p className="tp-philosophy-line" variants={item}>
              Messages burn — tokens are burned.
            </motion.p>
            <motion.p className="tp-philosophy-line" variants={item}>
              Privacy grows — scarcity increases.
            </motion.p>
            <motion.blockquote className="tp-philosophy-quote" variants={item}>
              The more active the usage — the more gets burned.
            </motion.blockquote>
            <motion.p className="tp-philosophy-body" variants={item}>
              Burned Chats deletes messages forever. BURN applies the same principle to money:
              a fixed 0.5% of every transfer is destroyed on-chain, permanently. No buybacks,
              no re-minting — just less supply with every transaction.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* 3. Key parameters */}
      <section className="tp-section" aria-label="Key parameters">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Key parameters</h2>
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
      <section className="tp-section tp-section--alt" aria-label="Deflationary mechanism">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Every transfer splits 1%</h2>
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
              aria-label="Fee split: 0.5% burned, 0.3% staking, 0.2% treasury, 99% to recipient"
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
                99% to recipient
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
              <h3 className="tp-card-title">Dynamic burn</h3>
              <p className="tp-card-body">
                The burn rate can scale with usage: +0.25% on large transfers (over 10 BURN) and
                +0.125% during high network activity (over 100 tx/hour), up to ~0.875%. A hard
                on-chain ceiling caps the total fee at 5% — no vote or code path can exceed it.
              </p>
            </motion.div>
            <motion.div className="tp-card" variants={item}>
              <h3 className="tp-card-title">Built-in supply floor</h3>
              <p className="tp-card-body">
                If supply ever falls below 100 BURN, the burn rate automatically drops to 0.1%,
                slowing deflation as the token becomes scarce.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* 5. Emission distribution */}
      <section className="tp-section" aria-label="Emission distribution">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Where the 1,000 BURN go</h2>
            <p className="tp-section-subtitle">
              Fixed allocation, enforced by vesting and on-chain emission contracts.
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
                <ExplorerAddress address={row.address} label={`${row.label} holder`} />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* 6. Staking */}
      <section className="tp-section tp-section--alt" aria-label="Staking tiers">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Staking tiers</h2>
            <p className="tp-section-subtitle">
              Longer locks earn a larger share of pool rewards and more voting power. Rewards
              inside a tier are proportional to your stake.
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
                    <dt>Reward share</dt>
                    <dd>{tier.share}</dd>
                  </div>
                  <div className="tp-tier-fact">
                    <dt>Voting power</dt>
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
            Yields are not fixed — they depend on pool emission and how many tokens are staked
            in your tier.
          </motion.p>
        </div>
      </section>

      {/* 7. Governance */}
      <section className="tp-section" aria-label="Governance">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Governed by stakers</h2>
            <p className="tp-section-subtitle">
              Every staker votes. Voting power grows with lock duration, not just stake size.
            </p>
          </motion.div>

          <motion.p
            className="tp-gov-formula"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            Voting Power = staked amount × time multiplier
          </motion.p>

          <motion.div
            className="tp-gov-table-wrapper"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={reveal}
          >
            <table className="tp-gov-table">
              <caption>Governance proposal types with quorum, approval threshold and voting period</caption>
              <thead>
                <tr>
                  <th scope="col">Proposal type</th>
                  <th scope="col">Quorum</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Voting period</th>
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
            Stakers control the burn rate (0.1–5%), tier reward shares, staking distribution
            rate and treasury spending — all within hard on-chain caps.
          </motion.p>
        </div>
      </section>

      {/* 8. Utility */}
      <section className="tp-section tp-section--alt" aria-label="What BURN is for">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">What BURN is for</h2>
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
      <section className="tp-section" aria-label="Contract addresses">
        <div className="tp-inner">
          <motion.div
            className="tp-section-header"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.5 }}
            variants={reveal}
          >
            <h2 className="tp-section-title">Verify the contracts</h2>
            <p className="tp-section-subtitle">
              BURN is fully on-chain. These are the canonical contract addresses — always
              double-check them before interacting with any token claiming to be BURN.
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
              <span className="tp-onchain-label">Network</span>
              <span className="tp-onchain-value">TON {TON_NETWORK}</span>
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
      <footer className="tp-section tp-section--alt tp-footer" aria-label="Token page footer">
        <div className="tp-inner">
          <div className="tp-footer-ctas">
            <a
              href={TOKENOMICS_URL}
              className="tp-cta tp-cta--primary"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Read the full BURN tokenomics specification (opens in new tab)"
            >
              Read the full tokenomics
              <ExternalLinkIcon />
            </a>
            <Link to="/" className="tp-cta">
              Back to Burned Chats
            </Link>
          </div>
          <p className="tp-footer-disclaimer">
            BURN is a utility token for the Burned Chats ecosystem. Nothing on this page is
            investment advice or an offer to sell securities.
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
  return (
    <a
      className="tp-addr"
      href={explorerHref(address)}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      aria-label={`${label} ${address} on tonviewer (opens in new tab)`}
    >
      {truncateAddress(address)}
      <ExternalLinkIcon />
    </a>
  );
}

function JettonMasterCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    const ok = await writeTextToClipboard(address);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="tp-hero-jetton">
      <span className="tp-hero-jetton-label">Jetton Master</span>
      <div className="tp-hero-jetton-row">
        <a
          className="tp-hero-jetton-addr"
          href={explorerHref(address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Jetton Master ${address} on tonviewer (opens in new tab)`}
        >
          {address}
          <ExternalLinkIcon />
        </a>
        <button
          type="button"
          className="tp-copy"
          onClick={() => void copyAddress()}
          aria-label={copied ? 'Jetton Master address copied' : 'Copy Jetton Master address'}
        >
          {copied ? <CheckIcon /> : <CopyGlyph />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
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
