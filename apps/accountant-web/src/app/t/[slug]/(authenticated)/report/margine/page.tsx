'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';

import { Alert, AlertDescription } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { getMargine, type MargineRow } from '@/lib/report-api';
import type { StatoMandato } from '@/lib/mandati-api';

// =============================================================================
// report/margine/page.tsx — Report margine per mandato/azienda (ADR-0054)
// =============================================================================
// Vista analitica read-only: ricavo concordato vs costo stimato (Σ importo
// prestazioni). Lista flat ordinata per margine ASC (peggiori prima, null in
// coda). Margine colorato: verde > 0, rosso < 0, grigio se null. Gating
// report.operativo.visualizza. Dark-safe + stringhe i18n (namespace `report`).
// =============================================================================

const STATO_BADGE: Record<StatoMandato, string> = {
  in_corso: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  sospeso: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  concluso: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  annullato: 'bg-muted text-muted-foreground',
};

function eur(n: number): string {
  return `€ ${n.toFixed(2)}`;
}

function margineClass(m: number | null): string {
  if (m === null) return 'text-muted-foreground';
  if (m > 0) return 'text-green-600 dark:text-green-400';
  if (m < 0) return 'text-red-600 dark:text-red-400';
  return 'text-foreground';
}

export default function ReportMarginePage(): JSX.Element {
  const t = useTranslations('report');
  const { permissions } = useAuth();
  const canView = permissions.includes('report.operativo.visualizza');

  const [rows, setRows] = useState<MargineRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setRows(await getMargine());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Alert>
          <AlertDescription>{t('forbidden')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <TrendingUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('col.azienda')}</th>
                <th className="px-3 py-2">{t('col.mandato')}</th>
                <th className="px-3 py-2">{t('col.stato')}</th>
                <th className="px-3 py-2 text-right">{t('col.concordato')}</th>
                <th className="px-3 py-2 text-right">{t('col.oreTotali')}</th>
                <th className="px-3 py-2 text-right">{t('col.importoPrestazioni')}</th>
                <th className="px-3 py-2 text-right">{t('col.margine')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.mandatoId}>
                  <td className="px-3 py-2">{r.aziendaNome}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.codice}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATO_BADGE[r.stato]}`}
                    >
                      {t(`stato.${r.stato}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.importoConcordato)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.oreTotali.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.importoPrestazioni === null ? '—' : eur(r.importoPrestazioni)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${margineClass(r.margine)}`}
                  >
                    {r.margine === null ? '—' : eur(r.margine)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
