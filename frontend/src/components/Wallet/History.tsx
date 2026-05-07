import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, Flame, Gift } from 'lucide-react';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { BurnTransaction } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import { PullToRefresh } from '@/components/PullToRefresh/PullToRefresh';

import styles from './Wallet.module.css';

const PAGE_SIZE = 12;

export type HistoryFilter = 'all' | 'sent' | 'received' | 'rewards';

export interface HistoryProps {
  burn: Pick<UseBurnToken, 'history' | 'refetch' | 'isLoading'>;
  /** When list is empty, primary CTA to return to balance and highlight receive flow. */
  onReceiveCta?: () => void;
}

function txIcon(type: BurnTransaction['type']): ReactNode {
  const iconProps = { size: 20, strokeWidth: 2.2, 'aria-hidden': true as const };
  switch (type) {
    case 'send':
      return <ArrowUpRight {...iconProps} />;
    case 'receive':
      return <ArrowDownLeft {...iconProps} />;
    case 'burn':
      return <Flame {...iconProps} />;
    case 'reward':
      return <Gift {...iconProps} />;
    default:
      return <ArrowUpRight {...iconProps} />;
  }
}

function formatFee(fee: BurnTransaction['fee']): string {
  if (!fee) return '—';
  const parts = [
    `🔥 ${formatBurn(fee.burn)}`,
    `💰 ${formatBurn(fee.staking)}`,
    `🏦 ${formatBurn(fee.treasury)}`,
  ];
  return parts.join(' · ');
}

/**
 * BURN wallet activity list with filters, pagination, and pull-to-refresh.
 */
export function History({ burn, onReceiveCta }: HistoryProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [filter, burn.history]);

  const filtered = useMemo(() => {
    const list = burn.history;
    switch (filter) {
      case 'sent':
        return list.filter((x) => x.type === 'send');
      case 'received':
        return list.filter((x) => x.type === 'receive');
      case 'rewards':
        return list.filter((x) => x.type === 'reward');
      default:
        return list;
    }
  }, [burn.history, filter]);

  const page = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await burn.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [burn]);

  const formatWhen = (ts: number): string => {
    const d = new Date(ts);
    return new Intl.DateTimeFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  };

  const handleKeyTabs = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const order: HistoryFilter[] = ['all', 'sent', 'received', 'rewards'];
    const i = order.indexOf(filter);
    const next =
      e.key === 'ArrowRight' ? order[Math.min(order.length - 1, i + 1)] : order[Math.max(0, i - 1)];
    setFilter(next);
  };

  return (
    <section aria-labelledby="wallet-history-heading" onKeyDown={handleKeyTabs}>
      <h2 id="wallet-history-heading" className={styles.srOnly}>
        {t('wallet.historySectionTitle')}
      </h2>
      <div
        className={styles.filterRow}
        role="tablist"
        aria-label={t('wallet.historyFilterAria')}
      >
        {(['all', 'sent', 'received', 'rewards'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`${styles.filterChip} ${filter === k ? styles.filterChipActive : ''}`}
            onClick={() => setFilter(k)}
          >
            {t(`wallet.filter.${k}`)}
          </button>
        ))}
      </div>

      <PullToRefresh onRefresh={onRefresh} isRefreshing={refreshing || burn.isLoading}>
        {page.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIllu} aria-hidden>
              📭
            </div>
            <p>{t('wallet.historyEmpty')}</p>
            <p>{t('wallet.historyEmptyHint')}</p>
            {onReceiveCta ? (
              <button type="button" className={styles.emptyCta} onClick={onReceiveCta}>
                {t('wallet.historyEmptyCta')}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className={styles.txList}>
            {page.map((tx) => (
              <li key={tx.hash} className={styles.txItem}>
                <div className={styles.txIcon}>{txIcon(tx.type)}</div>
                <div className={styles.txMain}>
                  <div className={styles.txAmount}>
                    {(() => {
                      const abs = tx.amount < 0n ? -tx.amount : tx.amount;
                      const sign = tx.type === 'send' ? '−' : '+';
                      return `${sign}${formatBurn(abs)}`;
                    })()}
                  </div>
                  <div className={styles.txMeta}>
                    {tx.counterparty} · {formatWhen(tx.timestamp)} · {tx.status}
                  </div>
                  <div className={styles.txMeta}>{formatFee(tx.fee)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PullToRefresh>

      {hasMore ? (
        <button
          type="button"
          className={styles.loadMore}
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          {t('wallet.loadMore')}
        </button>
      ) : null}
    </section>
  );
}
