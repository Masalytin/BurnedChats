import { memo, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FlameIcon } from '../../icons';
import './BurnAnimation.css';

interface BurnAnimationProps {
  /** Who burned the chat (display name) */
  burnedByName?: string;
  /** Whether current user initiated the burn */
  wasSelfBurn?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Duration of the animation in ms */
  duration?: number;
  /** Additional CSS class */
  className?: string;
}

/** Number of particle elements */
const PARTICLE_COUNT = 20;

/** Number of ash elements */
const ASH_COUNT = 15;

/**
 * Burn animation component that displays when a chat is destroyed.
 * 
 * Task 4.4.6 - Frontend: анимация уничтожения
 * 
 * Features:
 * - Full-screen overlay effect
 * - Fire/flame animation
 * - Particle effects (embers, ash)
 * - Message about who burned the chat
 * - Auto-completes after duration
 * 
 * @example
 * ```tsx
 * {isBurned && (
 *   <BurnAnimation
 *     burnedByName={burnedBy === userId ? 'You' : peerName}
 *     wasSelfBurn={burnedBy === userId}
 *     onComplete={() => navigate('/')}
 *   />
 * )}
 * ```
 */
export const BurnAnimation = memo(function BurnAnimation({
  burnedByName,
  wasSelfBurn = false,
  onComplete,
  duration = 3000,
  className = '',
}: BurnAnimationProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'ignite' | 'burn' | 'fade'>('ignite');
  const peerName = burnedByName || t('common.unknown');

  // Generate random particles
  const [particles] = useState(() =>
    Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1 + Math.random() * 1,
      size: 4 + Math.random() * 8,
    }))
  );

  // Generate random ash particles
  const [ashes] = useState(() =>
    Array.from({ length: ASH_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: 0.5 + Math.random() * 1,
      duration: 2 + Math.random() * 2,
      size: 3 + Math.random() * 5,
    }))
  );

  /**
   * Animation phase progression.
   */
  useEffect(() => {
    // Phase 1: Ignite (immediate)
    setPhase('ignite');

    // Phase 2: Full burn (after 300ms)
    const burnTimer = setTimeout(() => {
      setPhase('burn');
    }, 300);

    // Phase 3: Fade out (after duration - 500ms)
    const fadeTimer = setTimeout(() => {
      setPhase('fade');
    }, duration - 500);

    // Complete callback
    const completeTimer = setTimeout(() => {
      onComplete?.();
    }, duration);

    return () => {
      clearTimeout(burnTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  /**
   * Handle click to skip animation.
   */
  const handleClick = useCallback(() => {
    if (phase === 'burn' || phase === 'fade') {
      onComplete?.();
    }
  }, [phase, onComplete]);

  return (
    <div
      className={`burn-animation burn-animation--${phase} ${className}`}
      onClick={handleClick}
      role="presentation"
      aria-label={t('burnDialog.animationAria')}
    >
      {/* Background flame gradient */}
      <div className="burn-animation__backdrop" />

      {/* Central flame icon */}
      <div className="burn-animation__icon">
        <FlameIcon size={80} />
      </div>

      {/* Ember particles */}
      <div className="burn-animation__particles">
        {particles.map((p) => (
          <div
            key={p.id}
            className="burn-animation__particle"
            style={{
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              width: `${p.size}px`,
              height: `${p.size}px`,
            }}
          />
        ))}
      </div>

      {/* Ash particles */}
      <div className="burn-animation__ashes">
        {ashes.map((a) => (
          <div
            key={a.id}
            className="burn-animation__ash"
            style={{
              left: `${a.left}%`,
              animationDelay: `${a.delay}s`,
              animationDuration: `${a.duration}s`,
              width: `${a.size}px`,
              height: `${a.size}px`,
            }}
          />
        ))}
      </div>

      {/* Message */}
      <div className="burn-animation__message">
        <h2 className="burn-animation__title">
          <FlameIcon size={28} aria-hidden />
          <span>{wasSelfBurn ? t('burnDialog.titleBurned') : t('burnDialog.titleDestroyed')}</span>
        </h2>
        <p className="burn-animation__subtitle">
          {wasSelfBurn
            ? t('burnDialog.selfBurned')
            : t('burnDialog.peerBurned', { name: peerName })}
        </p>
        <p className="burn-animation__info">
          {t('burnDialog.destroyedInfo')}
        </p>
      </div>

      {/* Tap to continue hint */}
      <div className="burn-animation__hint">
        {t('burnDialog.tapToContinue')}
      </div>
    </div>
  );
});
