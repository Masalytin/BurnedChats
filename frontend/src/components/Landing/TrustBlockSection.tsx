import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { FlameIcon } from '../../icons';

export function TrustBlockSection() {
  const { t } = useTranslation();
  return (
    <>
      <motion.h2
        className="trust-title"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        {t('landing.trust.title')}
      </motion.h2>

      <div className="trust-columns">
        <motion.div
          className="trust-panel trust-panel--server"
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ amount: 0.3 }}
          transition={{ duration: 0.6 }}
        >
          <div className="trust-panel-header">
            <span className="dot" />
            {t('landing.trust.serverSees')}
          </div>
          <div className="trust-panel-body">
            <span className="k">session</span>: <span className="v">a1b2c3d4</span>{'\n'}
            <span className="k">from</span>: <span className="v">user_928471</span>{'\n'}
            <span className="k">to</span>: <span className="v">user_382910</span>{'\n'}
            <span className="k">payload</span>: <span className="v">0x8a4f2b…e7c103</span>{'\n'}
            <span className="k">status</span>: <span className="v">ACTIVE</span>{'\n'}
            <span className="k">ttl</span>: <span className="v">3600s</span>
          </div>
          <div className="trust-panel-caption">
            {t('landing.trust.encryptedNote')}
          </div>
        </motion.div>

        <motion.div
          className="trust-panel trust-panel--user"
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <div className="trust-panel-header">
            <span className="dot" />
            {t('landing.trust.youSee')}
          </div>
          <div className="trust-panel-body">
            <div className="bubble bubble--in">{t('landing.trust.demoIn1')}</div>
            <div className="bubble bubble--out">{t('landing.trust.demoIn2')}</div>
            <div className="bubble bubble--in">{t('landing.trust.demoIn3')}</div>
            <div className="burn-pill" aria-hidden="true">
              <FlameIcon size={16} aria-hidden="true" />
              {t('landing.trust.burnChat')}
            </div>
          </div>
          <div className="trust-panel-caption">
            {t('landing.trust.decryptedNote')}
          </div>
        </motion.div>
      </div>
    </>
  );
}
