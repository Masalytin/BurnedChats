import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com/Masalytin/BurnedChats';

const badges = ['ECDH P-256', 'AES-256-GCM', 'Web Crypto API', 'React', 'Spring Boot', 'Redis', 'TypeScript', 'Java 21'];

export function TechSection() {
  const { t } = useTranslation();
  return (
    <>
      <motion.div
        className="section-header"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="section-title">{t('landing.tech.title')}</h2>
      </motion.div>

      <div className="tech-badges">
        {badges.map((b, i) => (
          <motion.span
            key={b}
            className="tech-badge"
            initial={{ opacity: 0, scale: 0.7 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ amount: 0.3 }}
            transition={{ duration: 0.35, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] as const }}
          >
            {b}
          </motion.span>
        ))}
      </div>

      <motion.div
        className="tech-center"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.5 }}
        transition={{ duration: 0.5 }}
      >
        <p>{t('landing.tech.body')}</p>
        <a href={GITHUB_URL} className="tech-gh-btn" target="_blank" rel="noopener noreferrer" aria-label={t('landing.tech.githubAria')}>
          <GitHubIcon />
          {t('landing.tech.github')}
        </a>
      </motion.div>

      <motion.div
        className="tech-code"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.3 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="tech-code-bar">
          <span className="dot-r" />
          <span className="dot-y" />
          <span className="dot-g" />
        </div>
        <pre>
          <span className="cm">{`// ${t('landing.tech.codeComment')}`}</span>{'\n'}
          <span className="kw">const</span> sharedSecret = <span className="kw">await</span> crypto.subtle.<span className="fn">deriveBits</span>({'\n'}
          {'  '}{'{ '}<span className="pr">name</span>: <span className="st">&apos;ECDH&apos;</span>, <span className="pr">public</span>: peerPublicKey {'},'}{'\n'}
          {'  '}myPrivateKey,{'\n'}
          {'  '}256{'\n'}
          );
        </pre>
      </motion.div>
    </>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
