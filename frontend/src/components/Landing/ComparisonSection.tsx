import { motion } from 'motion/react';
import { Check, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  { f: 'r0', bc: 'y', tg: 'y', si: 'y', wa: 'y' },
  { f: 'r1', bc: 'y', tg: 'n', si: 'p', siL: 'partial', wa: 'n' },
  { f: 'r2', bc: 'y', bcL: 'auto', tg: 'p', tgL: 'timer', si: 'p', siL: 'timer', wa: 'p', waL: 'timer' },
  { f: 'r3', bc: 'y', tg: 'n', si: 'n', wa: 'n' },
  { f: 'r4', bc: 'y', tg: 'n', si: 'y', wa: 'y' },
  { f: 'r5', bc: 'y', tg: 'n', si: 'n', wa: 'n' },
  { f: 'r6', bc: 'y', tg: 'p', tgL: 'client', si: 'y', wa: 'n' },
];

function C({ s, l }: { s: 'y' | 'n' | 'p'; l?: string }) {
  const { t } = useTranslation();
  const label = l ? t(`landing.comparison.${l}`) : undefined;
  if (s === 'y') {
    return (
      <span className="c-yes" title={label || t('landing.comparison.yes')}>
        <Check size={16} strokeWidth={2.5} aria-hidden="true" />
        {label ? ` ${label}` : ''}
      </span>
    );
  }
  if (s === 'p') {
    return (
      <span className="c-part" title={label || t('landing.comparison.partial')}>
        <Minus size={16} strokeWidth={2.5} aria-hidden="true" /> {label || t('landing.comparison.partial')}
      </span>
    );
  }
  return (
    <span className="c-no" title={t('landing.comparison.no')}>
      <X size={16} strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

export function ComparisonSection() {
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
        <h2 className="section-title">{t('landing.comparison.title')}</h2>
      </motion.div>

      <motion.div
        className="comparison-table-wrapper"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        <table className="comparison-table">
          <caption>{t('landing.comparison.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('landing.comparison.feature')}</th>
              <th scope="col" className="hl">Burned Chats</th>
              <th scope="col">{t('landing.comparison.telegramSecret')}</th>
              <th scope="col">Signal</th>
              <th scope="col">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.f}>
                <td>{t(`landing.comparison.${r.f}`)}</td>
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
        {t('landing.comparison.note')}
      </p>
    </>
  );
}
