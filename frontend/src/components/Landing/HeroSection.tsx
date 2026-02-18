import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { ISourceOptions } from '@tsparticles/engine';

const TELEGRAM_BOT_URL = import.meta.env.VITE_TELEGRAM_BOT_URL || 'https://t.me/BurnedChatsBot';

const particlesOptions: ISourceOptions = {
  fullScreen: { enable: false },
  fpsLimit: 60,
  particles: {
    color: { value: '#ff6b35' },
    links: {
      color: '#ff6b35',
      distance: 150,
      enable: true,
      opacity: 0.08,
      width: 1,
    },
    move: {
      enable: true,
      speed: 0.6,
      direction: 'none',
      outModes: { default: 'out' },
    },
    number: {
      density: { enable: true },
      value: 50,
    },
    opacity: {
      value: { min: 0.03, max: 0.15 },
    },
    size: {
      value: { min: 1, max: 2 },
    },
  },
  detectRetina: true,
};

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function HeroSection() {
  const [particlesReady, setParticlesReady] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => setParticlesReady(true));
  }, []);

  const handleParticlesLoaded = useCallback(async () => {}, []);

  return (
    <section className="hero" aria-label="Hero">
      {particlesReady && (
        <Particles
          id="hero-particles"
          className="hero-particles"
          particlesLoaded={handleParticlesLoaded}
          options={particlesOptions}
        />
      )}

      <motion.div
        className="hero-content"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <FlameHeroIcon />
        </motion.div>

        <motion.h1 className="hero-title" variants={itemVariants}>
          Burned Chats
        </motion.h1>

        <motion.p className="hero-tagline" variants={itemVariants}>
          Messages that leave no trace.
        </motion.p>

        <motion.p className="hero-features" variants={itemVariants}>
          <span className="highlight">End-to-end encrypted</span>.{' '}
          <span className="highlight">Self-destructing</span>.{' '}
          <br />
          Built on <span className="highlight">zero-knowledge</span> architecture.
        </motion.p>

        <motion.a
          href={TELEGRAM_BOT_URL}
          className="hero-cta"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Burned Chats in Telegram"
          variants={itemVariants}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
        >
          <TelegramIcon />
          Open in Telegram
        </motion.a>
      </motion.div>

      <motion.div
        className="hero-scroll-indicator"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
      >
        <span>Scroll to explore</span>
        <ChevronDownIcon />
      </motion.div>
    </section>
  );
}

function FlameHeroIcon() {
  return (
    <svg className="hero-flame" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  );
}
