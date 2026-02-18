import { motion } from 'motion/react';

const steps = [
  {
    num: 1,
    title: 'Find',
    icon: SearchStepIcon,
    desc: 'Search for a Telegram user by username or ID.',
  },
  {
    num: 2,
    title: 'Invite',
    icon: SendStepIcon,
    desc: 'Send an encrypted chat request. They get a Telegram notification.',
  },
  {
    num: 3,
    title: 'Handshake',
    icon: HandshakeStepIcon,
    desc: 'Both devices perform an ECDH key exchange. A shared secret is created without the server ever seeing it.',
  },
  {
    num: 4,
    title: 'Verify',
    icon: ShieldStepIcon,
    desc: 'Compare visual fingerprints to ensure no one is intercepting the connection.',
  },
  {
    num: 5,
    title: 'Chat & Burn',
    icon: FlameStepIcon,
    desc: 'Exchange messages encrypted with AES-256-GCM. When done — burn everything.',
  },
];

const stepVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: i * 0.15,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

export function HowItWorksSection() {
  return (
    <section className="how-it-works" aria-label="How it works">
      <div className="landing-container">
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="section-title">How it works</h2>
          <p className="section-subtitle">A secure chat in 5 steps</p>
        </motion.div>

        <div className="timeline">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              className="timeline-step"
              custom={i}
              variants={stepVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
            >
              <div className="timeline-dot">{step.num}</div>
              <div className="timeline-content">
                <h3>
                  <step.icon />
                  {step.title}
                </h3>
                <p>{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="protocol-diagram"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.3 }}
          role="img"
          aria-label="ECDH key exchange protocol diagram"
        >
          <span className="label">{'Alice            Server           Bob'}</span>{'\n'}
          {'  │                │                │'}{'\n'}
          {'  ├── publicKey ──►│                │'}{'\n'}
          {'  │                ├── publicKey ──►│'}{'\n'}
          {'  │                │◄── publicKey ──┤'}{'\n'}
          {'  │◄── publicKey ──┤                │'}{'\n'}
          {'  │                │                │'}{'\n'}
          {'  │  '}<span className="secure">sharedSecret</span>{'  │   '}<span className="encrypted">??? blob</span>{'    │  '}<span className="secure">sharedSecret</span>{'\n'}
          {'  └────────────────┴────────────────┘'}
        </motion.div>
      </div>
    </section>
  );
}

function SearchStepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function SendStepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  );
}

function HandshakeStepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88" /><path d="m2 2 20 20" /><path d="M8 8a3 3 0 0 0 0 4.24l.88.88" />
    </svg>
  );
}

function ShieldStepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function FlameStepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
