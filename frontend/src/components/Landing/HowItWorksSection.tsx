import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

export function HowItWorksSection() {
  const { t } = useTranslation();
  const steps = [
    { num: 1, title: t('landing.howItWorks.s1Title'), icon: SearchIcon, desc: t('landing.howItWorks.s1Desc') },
    { num: 2, title: t('landing.howItWorks.s2Title'), icon: SendIcon, desc: t('landing.howItWorks.s2Desc') },
    { num: 3, title: t('landing.howItWorks.s3Title'), icon: HandshakeIcon, desc: t('landing.howItWorks.s3Desc') },
    { num: 4, title: t('landing.howItWorks.s4Title'), icon: ShieldIcon, desc: t('landing.howItWorks.s4Desc') },
    { num: 5, title: t('landing.howItWorks.s5Title'), icon: FlameIcon, desc: t('landing.howItWorks.s5Desc') },
  ];
  return (
    <>
      <motion.div
        className="section-header"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="section-title">{t('landing.howItWorks.title')}</h2>
        <p className="section-subtitle">{t('landing.howItWorks.subtitle')}</p>
      </motion.div>

      <div className="steps-grid">
        {steps.map((s, i) => (
          <motion.div
            key={s.num}
            className="step-card"
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ amount: 0.3 }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const }}
          >
            <div className="step-num">{s.num}</div>
            <div className="step-body">
              <h3><s.icon />{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="protocol-visual"
        initial={{ opacity: 0, scale: 0.92 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ amount: 0.4 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        role="img"
        aria-label={t('landing.howItWorks.protocolAria')}
      >
        <div className="pv-header">
          <div className="pv-col">Alice<span>{t('landing.howItWorks.yourDevice')}</span></div>
          <div className="pv-col">Server<span>{t('landing.howItWorks.relayOnly')}</span></div>
          <div className="pv-col">Bob<span>{t('landing.howItWorks.peerDevice')}</span></div>
        </div>

        <div className="pv-lines">
          <div className="pv-col pv-line-col" /><div className="pv-col pv-line-col" /><div className="pv-col pv-line-col" />
        </div>

        <div className="pv-rows">
          <ProtocolRow from={0} to={1} label="publicKey" />
          <ProtocolRow from={1} to={2} label="publicKey" />
          <ProtocolRow from={2} to={1} label="publicKey" />
          <ProtocolRow from={1} to={0} label="publicKey" />
        </div>

        <div className="pv-result">
          <div className="pv-pill pv-pill--ok">sharedSecret</div>
          <div className="pv-pill pv-pill--err">??? blob</div>
          <div className="pv-pill pv-pill--ok">sharedSecret</div>
        </div>
      </motion.div>
    </>
  );
}

function ProtocolRow({ from, to, label }: { from: number; to: number; label: string }) {
  const cols = [0, 1, 2];
  const min = Math.min(from, to);
  const max = Math.max(from, to);
  const goesRight = to > from;

  return (
    <div className="pv-row">
      {cols.map((c) => {
        if (c === min) {
          return (
            <div key={c} className={`pv-cell pv-cell--span${max - min}`}>
              <div className={`pv-arrow ${goesRight ? 'pv-arrow--right' : 'pv-arrow--left'}`}>
                <span className="pv-arrow-label">{label}</span>
                <span className="pv-arrow-line" />
                <span className="pv-arrow-head">{goesRight ? '▸' : '◂'}</span>
              </div>
            </div>
          );
        }
        if (c > min && c <= max) return null;
        return <div key={c} className="pv-cell" />;
      })}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  );
}

function HandshakeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88" />
      <path d="m2 2 20 20" /><path d="M8 8a3 3 0 0 0 0 4.24l.88.88" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
