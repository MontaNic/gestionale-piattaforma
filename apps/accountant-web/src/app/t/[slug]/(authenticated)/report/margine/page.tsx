'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles, TrendingUp } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { getAiStatus } from '@/lib/comunicazioni-api';
import {
  getMargine,
  getMargineInsight,
  type MargineInsight,
  type MargineRow,
} from '@/lib/report-api';
import type { StatoMandato } from '@/lib/mandati-api';

// =============================================================================
// report/margine/page.tsx — Report margine per mandato/azienda (ADR-0054, ADR-0057)
// =============================================================================
// Vista analitica read-only: ricavo concordato vs costo stimato (Σ importo
// prestazioni). Lista flat ordinata per margine ASC (peggiori prima, null in
// coda). Margine colorato: verde > 0, rosso < 0, grigio se null. Gating
// report.operativo.visualizza. Dark-safe + stringhe i18n (namespace `report`).
//
// Insight AI (ADR-0057): se la feature è attiva (GET /ai/status), un bottone
// genera una sintesi AI dei margini, resa in un box sopra la tabella. Un
// disclaimer di copertura (mandati con prestazioni valorizzate vs totali) è
// sempre visibile quando i dati sono parziali — preventivo, derivato dalle
// righe già caricate, indipendente dall'AI.
// =============================================================================

const STATO_BADGE: Record<StatoMandato, string> = {
  in_corso: 'bg-info-soft text-info',
  sospeso: 'bg-warn-soft text-warn',
  concluso: 'bg-success-soft text-success',
  annullato: 'bg-muted text-muted-foreground',
};

function eur(n: number): string {
  return `€ ${n.toFixed(2)}`;
}

function margineClass(m: number | null): string {
  if (m === null) return 'text-muted-foreground';
  if (m > 0) return 'text-success';
  if (m < 0) return 'text-destructive-soft-foreground';
  return 'text-foreground';
}

export default function ReportMarginePage(): JSX.Element {
  const t = useTranslations('report');
  const { permissions } = useAuth();
  const canView = permissions.includes('report.operativo.visualizza');

  const [rows, setRows] = useState<MargineRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [insight, setInsight] = useState<MargineInsight | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      // Dati + stato AI in parallelo (pattern comunicazioni). Lo stato AI è
      // best-effort: un suo errore non deve impedire il caricamento del report.
      const [margine, status] = await Promise.all([
        getMargine(),
        getAiStatus().catch(() => ({ aiEnabled: false })),
      ]);
      setRows(margine);
      setAiEnabled(status.aiEnabled);
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const analizza = useCallback(async (): Promise<void> => {
    setAnalyzing(true);
    setInsightError(null);
    try {
      setInsight(await getMargineInsight());
    } catch {
      setInsightError(t('ai.errore'));
    } finally {
      setAnalyzing(false);
    }
  }, [t]);

  // Copertura derivata dai dati già caricati: il disclaimer è preventivo
  // (visibile prima dell'insight, indipendente dall'AI). Il campo `copertura`
  // della risposta serve al prompt server-side, non a questo avviso (ADR-0057).
  const totaliMandati = rows.length;
  const conPrestazioni = rows.filter((r) => r.importoPrestazioni !== null).length;
  const coperturaParziale = totaliMandati > 0 && conPrestazioni < totaliMandati;

  // Corpo del box insight: prosa AI quando aiGenerated, altrimenti stringa
  // deterministica localizzata FE (path < 2 mandati, ADR-0057). Per il singolo
  // mandato i dati di interpolazione vengono dalle righe già caricate.
  function insightBody(data: MargineInsight): string {
    if (data.aiGenerated) return data.insight ?? '';
    if (data.copertura.totali === 0) return t('ai.nessunMandato');
    const r = rows[0];
    const margine = r && r.margine !== null ? eur(r.margine) : '—';
    return t('ai.singoloMandato', { nome: r?.aziendaNome ?? '', margine });
  }

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

      {!isLoading && coperturaParziale && (
        <Alert>
          <AlertDescription className="text-warn">
            {t('ai.copertura', { conPrestazioni, totali: totaliMandati })}
          </AlertDescription>
        </Alert>
      )}

      {aiEnabled && !isLoading && rows.length > 0 && (
        <section className="space-y-3">
          <Button variant="outline" size="sm" onClick={() => void analizza()} disabled={analyzing}>
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {analyzing ? t('ai.caricamento') : t('ai.analizza')}
          </Button>

          {insightError && (
            <Alert variant="destructive">
              <AlertDescription>{insightError}</AlertDescription>
            </Alert>
          )}

          {insight && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t('ai.titolo')}
              </h2>
              <p className="whitespace-pre-line text-sm text-foreground">{insightBody(insight)}</p>
            </div>
          )}
        </section>
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
