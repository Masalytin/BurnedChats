import { motion } from 'motion/react';

interface Row {
  f: string;
  bc: 'y' | 'n' | 'p';
  bcL?: string;
  tg: 'y' | 'n' | 'p';
  tgL?: string;
  si: 'y' | 'n' | 'p';
  siL?: string;
  wa: 'y' | 'n' | 'p';
  waL?: string;
}

const rows: Row[] = [
  { f: 'End-to-End Encryption', bc: 'y', tg: 'y', si: 'y', wa: 'y' },
  { f: 'Zero-Knowledge Server', bc: 'y', tg: 'n', si: 'p', siL: 'partial', wa: 'n' },
  { f: 'Self-Destructing Messages', bc: 'y', bcL: 'auto', tg: 'p', tgL: 'timer', si: 'p', siL: 'timer', wa: 'p', waL: 'timer' },
  { f: 'No Persistent Storage', bc: 'y', tg: 'n', si: 'n', wa: 'n' },
  { f: 'Visual Verification', bc: 'y', tg: 'n', si: 'y', wa: 'y' },
  { f: 'No Phone Number', bc: 'y', tg: 'n', si: 'n', wa: 'n' },
  { f: 'Open Source', bc: 'y', tg: 'p', tgL: 'client', si: 'y', wa: 'n' },
];

function C({ s, l }: { s: 'y' | 'n' | 'p'; l?: string }) {
  if (s === 'y') return <span className="c-yes" title={l || 'Yes'}>✓{l ? ` ${l}` : ''}</span>;
  if (s === 'p') return <span className="c-part" title={l || 'Partial'}>~ {l || 'partial'}</span>;
  return <span className="c-no" title="No">✗</span>;
}

export function ComparisonSection() {
  return (
    <>
      <motion.div
        className="section-header"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="section-title">How we compare</h2>
      </motion.div>

      <motion.div
        className="comparison-table-wrapper"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        <table className="comparison-table">
          <caption>Feature comparison between messaging apps</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col" className="hl">Burned Chats</th>
              <th scope="col">Telegram Secret</th>
              <th scope="col">Signal</th>
              <th scope="col">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.f}>
                <td>{r.f}</td>
                <td className="hl"><C s={r.bc} l={r.bcL} /></td>
                <td><C s={r.tg} l={r.tgL} /></td>
                <td><C s={r.si} l={r.siL} /></td>
                <td><C s={r.wa} l={r.waL} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      <p className="comparison-note">
        Comparison based on publicly available information. Features may change.
      </p>
    </>
  );
}
