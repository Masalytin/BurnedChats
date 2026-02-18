import { motion } from 'motion/react';

export function TrustBlockSection() {
  return (
    <section className="trust-block" aria-label="Trust block">
      <div className="landing-container">
        <motion.h2
          className="trust-block-title"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          Don't trust us. You don't have to.
        </motion.h2>

        <div className="trust-columns">
          {/* Server side */}
          <motion.div
            className="trust-panel trust-panel--server"
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6 }}
          >
            <div className="trust-panel-header">
              <span className="dot" />
              What the server sees
            </div>
            <div className="trust-panel-body">
              <span className="key">session</span>: <span className="val">a1b2c3d4</span>{'\n'}
              <span className="key">from</span>: <span className="val">user_928471</span>{'\n'}
              <span className="key">to</span>: <span className="val">user_382910</span>{'\n'}
              <span className="key">payload</span>: <span className="val">0x8a4f2b…e7c103</span>{'\n'}
              <span className="key">status</span>: <span className="val">ACTIVE</span>{'\n'}
              <span className="key">ttl</span>: <span className="val">3600s</span>
            </div>
            <div className="trust-panel-caption">
              Encrypted bytes. Metadata. Nothing else.
            </div>
          </motion.div>

          {/* User side */}
          <motion.div
            className="trust-panel trust-panel--user"
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="trust-panel-header">
              <span className="dot" />
              What you see
            </div>
            <div className="trust-panel-body">
              <div className="chat-bubble chat-bubble--incoming">
                Hey, are we still meeting tomorrow?
              </div>
              <div className="chat-bubble chat-bubble--outgoing">
                Yeah! Let's do 3pm at the usual place.
              </div>
              <div className="chat-bubble chat-bubble--incoming">
                Sounds good. I'll bring the documents.
              </div>
              <div className="chat-burn-btn" aria-hidden="true">
                🔥 Burn Chat
              </div>
            </div>
            <div className="trust-panel-caption">
              Decrypted on your device. Keys never leave your browser.
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
