import { motion } from 'motion/react';

const principles = [
  {
    icon: ShieldLockIcon,
    title: 'Zero Knowledge',
    description: 'The server never sees your messages, keys, or passwords. It relays encrypted bytes — nothing more.',
  },
  {
    icon: FlameIcon,
    title: 'Ephemeral by Design',
    description: 'Messages exist only in the moment. When you burn a chat, all data is permanently destroyed. No backups, no traces.',
  },
  {
    icon: KeyIcon,
    title: 'End-to-End Encrypted',
    description: 'ECDH key exchange + AES-256-GCM encryption. Keys live only on your device and never leave it.',
  },
  {
    icon: FingerprintIcon,
    title: 'Verified Identity',
    description: 'Visual fingerprint verification protects against man-in-the-middle attacks. You know who you\'re talking to.',
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.12,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

export function ManifestoSection() {
  return (
    <section id="manifesto" className="manifesto" aria-label="Our principles">
      <div className="landing-container">
        <motion.p
          className="manifesto-quote"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
          We can't read your messages. Even if we wanted to.
        </motion.p>

        <div className="manifesto-grid">
          {principles.map((p, i) => (
            <motion.div
              key={p.title}
              className="manifesto-card"
              custom={i}
              variants={cardVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <div className="manifesto-card-icon">
                <p.icon />
              </div>
              <h3>{p.title}</h3>
              <p>{p.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShieldLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <rect width="8" height="5" x="8" y="10" rx="1" />
      <path d="M10 10V8a2 2 0 1 1 4 0v2" />
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

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.3 9.3" />
      <path d="M18.5 5.5 20 7" />
      <path d="m15 8 1.5 1.5" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2" />
    </svg>
  );
}
