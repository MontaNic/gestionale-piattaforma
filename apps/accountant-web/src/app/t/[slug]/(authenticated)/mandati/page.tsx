'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileSignature } from 'lucide-react';

import { Alert, AlertDescription } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { getMandati, STATI_MANDATO, type Mandato, type StatoMandato } from '@/lib/mandati-api';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';

// =============================================================================
// mandati/page.tsx — Lista mandati/incarichi (ADR-0051, Onda 3 Task 2)
// =============================================================================
// Read-only list con filtro stato. La creazione avviene dal preventivo accettato
// (azione "Crea mandato"), non da qui. Gating: mandati.visualizza. Stringhe i18n
// via next-intl (namespace `mandati`).
// =============================================================================

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const STATO_BADGE: Record<StatoMandato, string> = {
  in_corso: 'bg-info-soft text-info',
  sospeso: 'bg-warn-soft text-warn',
  concluso: 'bg-success-soft text-success',
  annullato: 'bg-muted text-muted-foreground',
};

export default function MandatiPage(): JSX.Element {
  const t = useTranslations('mandati');
  const { slug } = useParams<{ slug: string }>();
  const { permissions } = useAuth();
  const canView = permissions.includes('mandati.visualizza');

  const [mandati, setMandati] = useState<Mandato[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [statoFilter, setStatoFilter] = useState<'' | StatoMandato>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const aziendaNome = useMemo(() => {
    const m = new Map(aziende.map((a) => [a.id, a.nome]));
    return (id: string): string => m.get(id) ?? '—';
  }, [aziende]);

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [mand, az] = await Promise.all([
        getMandati(statoFilter ? { stato: statoFilter } : {}),
        listAziende(),
      ]);
      setMandati(mand);
      setAziende(az);
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView, statoFilter]);

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
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileSignature className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <select
          className={SELECT_CLASS + ' max-w-[12rem]'}
          value={statoFilter}
          onChange={(e) => setStatoFilter(e.target.value as '' | StatoMandato)}
        >
          <option value="">{t('allStates')}</option>
          {STATI_MANDATO.map((s) => (
            <option key={s} value={s}>
              {t(`stato.${s}`)}
            </option>
          ))}
        </select>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : mandati.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('col.codice')}</th>
                <th className="px-3 py-2">{t('col.azienda')}</th>
                <th className="px-3 py-2">{t('col.stato')}</th>
                <th className="px-3 py-2 text-right">{t('col.importo')}</th>
                <th className="px-3 py-2">{t('col.inizio')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {mandati.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/t/${slug}/mandati/${m.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {m.codice}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{aziendaNome(m.aziendaId)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATO_BADGE[m.stato]}`}
                    >
                      {t(`stato.${m.stato}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">€ {m.importoConcordato.toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.inizio ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
