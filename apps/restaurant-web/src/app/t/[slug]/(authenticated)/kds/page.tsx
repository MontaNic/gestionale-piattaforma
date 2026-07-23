'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { cambiaStatoComanda, listComande } from '@/lib/comande-api';
import { PORTATA_ORDER, REPARTO_ORDER } from '@/lib/conti-types';
import type { Comanda, ComandaFeedRiga, Portata, StatoComanda } from '@/lib/conti-types';
import { messageForError } from '@/lib/error-codes';
import { usePollingRefresh } from '@/lib/usePollingRefresh';

// =============================================================================
// kds/page.tsx — Board KDS (Fase 1, ADR-0069): feed + avanzamento forward-only
// =============================================================================
// Display da muro: colonne per reparto, card per comanda (FIFO dal BE), righe per
// portata in ordine di SERVIZIO. Refresh a polling (usePollingRefresh — DP-1).
// Avanzamento stato FORWARD-ONLY (inviata→in_preparazione→pronta) con UI
// ottimistica + rollback su errore.
//
// Anti-race polling↔ottimistica: le override ottimistiche vivono in un layer
// `pending` (Record<id,StatoComanda>) applicato SOPRA il feed pollato. Il polling
// rimpiazza la base ma la override vince nel render → un refresh in volo non può
// mai regredire visivamente uno stato appena avanzato. La override si pulisce
// alla conferma (dopo refetch) o al rollback (errore).
// =============================================================================

const KDS_POLL_INTERVAL_MS = 8_000;

/** Transizione forward-only immediata (subset di quella BE, che ammette lo skip). */
const STATO_NEXT: Record<StatoComanda, StatoComanda | null> = {
  inviata: 'in_preparazione',
  in_preparazione: 'pronta',
  pronta: null,
};

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

function ComandaCard({
  comanda,
  canAdvance,
  isAdvancing,
  onAdvance,
}: {
  comanda: Comanda;
  canAdvance: boolean;
  isAdvancing: boolean;
  onAdvance: (comanda: Comanda) => void;
}): JSX.Element {
  const t = useTranslations('kds');
  const tc = useTranslations('comande');
  const gruppi = groupRigheByPortata(comanda.righe);
  const next = STATO_NEXT[comanda.stato];

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
        {canAdvance && next && (
          <Button
            className="mt-2 h-12 w-full text-lg font-semibold"
            disabled={isAdvancing}
            onClick={() => onAdvance(comanda)}
          >
            {t(`advance.${next}`)}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function KdsPage(): JSX.Element {
  const t = useTranslations('kds');
  const tc = useTranslations('comande');
  const { permissions } = useAuth();
  const canView = permissions.includes('comande.visualizza');
  const canAdvance = permissions.includes('comande.stato.cambia');

  const [comande, setComande] = useState<Comanda[]>([]);
  const [pending, setPending] = useState<Record<string, StatoComanda>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      setComande(await listComande()); // base pollata; le override `pending` vincono nel render
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

  const handleAdvance = useCallback(
    async (comanda: Comanda): Promise<void> => {
      const next = STATO_NEXT[comanda.stato];
      if (!next) return;
      setAdvanceError(null);
      setPending((p) => ({ ...p, [comanda.id]: next })); // ottimistico
      try {
        await cambiaStatoComanda(comanda.id, next);
        await load(); // riconcilia con la fonte autoritativa
      } catch (err) {
        setAdvanceError(messageForError(err));
      } finally {
        // Pulisce l'override: alla conferma il feed riflette già `next`
        // (o la comanda è uscita se `pronta`); all'errore = rollback allo stato reale.
        setPending((p) => {
          const { [comanda.id]: _drop, ...rest } = p;
          return rest;
        });
      }
    },
    [load],
  );

  if (!canView) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('noAccess')}</AlertDescription>
      </Alert>
    );
  }

  // Applica le override ottimistiche sopra il feed pollato.
  const view = comande.map((c) => {
    const override = pending[c.id];
    return override ? { ...c, stato: override } : c;
  });
  const repartiPresenti = REPARTO_ORDER.filter((rep) => view.some((c) => c.reparto === rep));

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

      {advanceError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t('advanceError')}</span>
            <Button variant="outline" size="sm" onClick={() => setAdvanceError(null)}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-lg text-muted-foreground">{t('loading')}</p>
      ) : view.length === 0 && !loadError ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-3xl font-medium text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {repartiPresenti.map((reparto) => {
            const cards = view.filter((c) => c.reparto === reparto);
            return (
              <section key={reparto} className="space-y-3">
                <h2 className="flex items-baseline gap-2 text-2xl font-semibold">
                  {tc(`dept.${reparto}`)}
                  <span className="text-base font-normal tabular-nums text-muted-foreground">
                    {cards.length}
                  </span>
                </h2>
                {cards.map((comanda) => (
                  <ComandaCard
                    key={comanda.id}
                    comanda={comanda}
                    canAdvance={canAdvance}
                    isAdvancing={pending[comanda.id] !== undefined}
                    onAdvance={handleAdvance}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
