import { motion } from 'motion/react';

interface RowData {
  feature: string;
  bc: 'yes' | 'no' | 'partial';
  bcLabel?: string;
  tg: 'yes' | 'no' | 'partial';
  tgLabel?: string;
  signal: 'yes' | 'no' | 'partial';
  signalLabel?: string;
  wa: 'yes' | 'no' | 'partial';
  waLabel?: string;
}

const rows: RowData[] = [
  { feature: 'End-to-End Encryption', bc: 'yes', tg: 'yes', signal: 'yes', wa: 'yes' },
  { feature: 'Zero-Knowledge Server', bc: 'yes', tg: 'no', signal: 'partial', signalLabel: 'partial', wa: 'no' },
  { feature: 'Self-Destructing Messages', bc: 'yes', bcLabel: 'auto', tg: 'partial', tgLabel: 'timer', signal: 'partial', signalLabel: 'timer', wa: 'partial', waLabel: 'timer' },
  { feature: 'No Persistent Storage', bc: 'yes', tg: 'no', signal: 'no', wa: 'no' },
  { feature: 'Visual Verification', bc: 'yes', tg: 'no', signal: 'yes', wa: 'yes' },
  { feature: 'No Phone Number Required', bc: 'yes', tg: 'no', signal: 'no', wa: 'no' },
  { feature: 'Open Source', bc: 'yes', tg: 'partial', tgLabel: 'client', signal: 'yes', wa: 'no' },
];

function Cell({ status, label }: { status: 'yes' | 'no' | 'partial'; label?: string }) {
  if (status === 'yes') return <span className="cell-yes" title={label || 'Yes'}>✓{label ? ` ${label}` : ''}</span>;
  if (status === 'partial') return <span className="cell-partial" title={label || 'Partial'}>~ {label || 'partial'}</span>;
  return <span className="cell-no" title="No">✗</span>;
}

export function ComparisonSection() {
  return (
    <section className="comparison" aria-label="Comparison">
      <div className="landing-container">
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="section-title">How we compare</h2>
        </motion.div>

        <motion.div
          className="comparison-table-wrapper"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6 }}
        >
          <table className="comparison-table">
            <caption>Feature comparison between messaging apps</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col" className="highlight-col">Burned Chats</th>
                <th scope="col">Telegram Secret</th>
                <th scope="col">Signal</th>
                <th scope="col">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td className="highlight-col"><Cell status={row.bc} label={row.bcLabel} /></td>
                  <td><Cell status={row.tg} label={row.tgLabel} /></td>
                  <td><Cell status={row.signal} label={row.signalLabel} /></td>
                  <td><Cell status={row.wa} label={row.waLabel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <p className="comparison-note">
          Comparison based on publicly available information. Features may change.
        </p>
      </div>
    </section>
  );
}
