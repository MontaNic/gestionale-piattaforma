'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { listConti } from '@/lib/conti-api';
import { listTables } from '@/lib/table-api';
import type { Conto } from '@/lib/conti-types';
import { messageForError } from '@/lib/error-codes';

// =============================================================================
// cassa/page.tsx — Index cassa: i conti aperti da incassare (PR2, ADR-0082 D1)
// =============================================================================
// Vista DEDICATA, separata da `comande`: il cassiere entra da qui e arriva al
// pannello di pagamento (`/cassa/{id}`) senza passare dalla gestione righe.
// Client component, fetch nel `load`, nessun polling (D1) — pattern
// `comande/page.tsx`.
//
// ⚠️ NESSUN IMPORTO PER RIGA (ADR-0082 D5): `GET /conti` restituisce il Conto
// "flat", che non espone né totale né residuo (li deriva solo `GET /conti/:id`).
// Mostrarli qui costerebbe N fetch per-conto. Registrato come
// TD-conti-list-amounts — trigger: "il cassiere deve prioritizzare i conti per
// importo a colpo d'occhio dall'index".
//
// Gate di pagina: `cassa.visualizza`. Il fetch usa però `GET /conti`, che il BE
// tiene su `comande.visualizza` (scelta ADR-0081 D5: i due permessi restano
// indipendenti) → un utente con cassa.* ma senza comande.visualizza vede il
// messaggio di errore del 403, non una lista vuota silenziosa.
// =============================================================================

export default function CassaListPage(): JSX.Element {
  const t = useTranslations('cassa');
  const { tenant, permissions } = useAuth();
  const canView = permissions.includes('cassa.visualizza');

  const [conti, setConti] = useState<Conto[]>([]);
  // tavoloId → numero. Il numero è l'unica label sensata per il cassiere; l'id
  // grezzo resta il fallback se `tavoli.visualizza` manca (fetch in try/catch,
  // come la risoluzione singola in comande/[contoId]).
  const [tavoliById, setTavoliById] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setConti(await listConti({ stato: 'aperto' }));
      try {
        const tavoli = await listTables();
        setTavoliById(new Map(tavoli.map((tv) => [tv.id, tv.numero])));
      } catch {
        setTavoliById(new Map());
      }
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

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Alert variant="destructive">
          <AlertDescription>{t('noAccess')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
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
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : conti.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <ul className="space-y-3" data-testid="cassa-conti-list">
          {conti.map((conto) => (
            <li key={conto.id}>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{t(`channel.${conto.channel}`)}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {conto.tavoloId
                        ? `${t('tavolo')} ${tavoliById.get(conto.tavoloId) ?? conto.tavoloId}`
                        : t('noTavolo')}
                      {conto.coperti != null && ` · ${t('coperti')}: ${conto.coperti}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {t(`stato.${conto.stato}`)}
                  </span>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/t/${tenant.slug}/cassa/${conto.id}`}>{t('open')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
