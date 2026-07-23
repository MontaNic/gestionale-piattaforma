'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { listComande } from '@/lib/comande-api';
import { PORTATA_ORDER, REPARTO_ORDER } from '@/lib/conti-types';
import type { Comanda, ComandaFeedRiga, Portata, StatoComanda } from '@/lib/conti-types';
import { messageForError } from '@/lib/error-codes';
import { usePollingRefresh } from '@/lib/usePollingRefresh';

// =============================================================================
// kds/page.tsx — Board KDS (Fase 1, ADR-0069): feed comande per reparto/portata
// =============================================================================
// Sostituisce il placeholder. Display da muro: colonne per reparto, card per
// comanda (FIFO dal BE), righe raggruppate per portata in ordine di SERVIZIO.
// Refresh a polling (usePollingRefresh, visibility-aware — DP-1, SSE deferito).
// Tipografia grande / contrasto alto: leggibile a 2-3 metri. Le note del
// cameriere sono evidenziate (info critica per la cucina).
// L'avanzamento stato (forward-only) arriva nel commit successivo.
// =============================================================================

const KDS_POLL_INTERVAL_MS = 8_000; // cucina: refresh frequente ma non aggressivo

/** Raggruppa le righe di una comanda per portata, in ordine di servizio. */
function groupRigheByPortata(
  righe: ComandaFeedRiga[],
): Array<{ portata: Portata; righe: ComandaFeedRiga[] }> {
  return PORTATA_ORDER.map((portata) => ({
    portata,
    righe: righe.filter((r) => r.portata === portata),
  })).filter((g) => g.righe.length > 0);
}

function statoBadgeClass(stato: StatoComanda): string {
  switch (stato) {
    case 'inviata':
      return 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200';
    case 'in_preparazione':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
    case 'pronta':
      return 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200';
  }
}

function ComandaCard({ comanda }: { comanda: Comanda }): JSX.Element {
  const t = useTranslations('kds');
  const tc = useTranslations('comande');
  const gruppi = groupRigheByPortata(comanda.righe);

  return (
    <Card className="border-2">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <span className="text-xl font-bold">
          {comanda.tavoloNumero ? `${t('tavolo')} ${comanda.tavoloNumero}` : t('noTavolo')}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-sm font-semibold',
            statoBadgeClass(comanda.stato),
          )}
        >
          {t(`stato.${comanda.stato}`)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {gruppi.map((g) => (
          <div key={g.portata} className="space-y-1">
            {gruppi.length > 1 && g.portata !== 'nessuna' && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tc(`portata.${g.portata}`)}
              </p>
            )}
            <ul className="space-y-1.5">
              {g.righe.map((r) => (
                <li key={r.id} className="leading-snug">
                  <span className="text-2xl font-bold tabular-nums">{r.quantita}×</span>{' '}
                  <span className="text-xl">{r.nomeArticolo}</span>
                  {r.note && (
                    <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-base font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
                      {r.note}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function KdsPage(): JSX.Element {
  const t = useTranslations('kds');
  const tc = useTranslations('comande');
  const { permissions } = useAuth();
  const canView = permissions.includes('comande.visualizza');

  const [comande, setComande] = useState<Comanda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      setComande(await listComande()); // default: inviata + in_preparazione, FIFO
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
    else setIsLoading(false);
  }, [canView, load]);

  usePollingRefresh(load, { intervalMs: KDS_POLL_INTERVAL_MS, enabled: canView });

  if (!canView) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('noAccess')}</AlertDescription>
      </Alert>
    );
  }

  const repartiPresenti = REPARTO_ORDER.filter((rep) => comande.some((c) => c.reparto === rep));

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="hidden text-base text-muted-foreground sm:block">{t('subtitle')}</p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-lg text-muted-foreground">{t('loading')}</p>
      ) : comande.length === 0 && !loadError ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-3xl font-medium text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {repartiPresenti.map((reparto) => {
            const cards = comande.filter((c) => c.reparto === reparto);
            return (
              <section key={reparto} className="space-y-3">
                <h2 className="flex items-baseline gap-2 text-2xl font-semibold">
                  {tc(`dept.${reparto}`)}
                  <span className="text-base font-normal tabular-nums text-muted-foreground">
                    {cards.length}
                  </span>
                </h2>
                {cards.map((comanda) => (
                  <ComandaCard key={comanda.id} comanda={comanda} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
