'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Plus } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { NuovaComunicazioneForm } from '@/components/comunicazioni/NuovaComunicazioneForm';
import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import { createComunicazione, getComunicazioni } from '@/lib/comunicazioni-api';
import type { Comunicazione, CreateComunicazioneInput } from '@/lib/comunicazioni-types';

// =============================================================================
// comunicazioni/page.tsx — Inbox thread studio↔cliente (ADR-0043, solo operatore)
// =============================================================================
// Client component (pattern scadenze/page): fetch via comunicazioni-api, stato
// React locale, refetch on mutation. Filtri stato/daPrendere/urgente vanno al
// backend. Nome azienda risolto client-side con listAziende(). Apertura thread
// via form inline (gated su comunicazioni.gestisci). Riga → dettaglio thread.
// =============================================================================

type StatoFilter = 'aperte' | 'chiuse' | 'tutte';

export default function ComunicazioniPage(): JSX.Element {
  const t = useTranslations('comunicazioni');
  const locale = useLocale();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { permissions } = useAuth();
  const canManage = permissions.includes('comunicazioni.gestisci');

  const [items, setItems] = useState<Comunicazione[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [filterStato, setFilterStato] = useState<StatoFilter>('aperte');
  const [filterDaPrendere, setFilterDaPrendere] = useState(false);
  const [filterUrgente, setFilterUrgente] = useState(false);

  const SELECT_CLASS =
    'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(
        await getComunicazioni({
          chiusa: filterStato === 'tutte' ? undefined : filterStato === 'chiuse',
          daPrendere: filterDaPrendere || undefined,
          urgente: filterUrgente || undefined,
        }),
      );
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [filterStato, filterDaPrendere, filterUrgente]);

  useEffect(() => {
    void listAziende()
      .then(setAziende)
      .catch(() => setAziende([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const aziendaById = useMemo(() => {
    const m = new Map<string, Azienda>();
    for (const a of aziende) m.set(a.id, a);
    return m;
  }, [aziende]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  async function handleCreate(input: CreateComunicazioneInput): Promise<void> {
    setCreateError(null);
    try {
      await createComunicazione(input);
    } catch (err) {
      setCreateError(messageForError(err));
      return;
    }
    setCreating(false);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canManage && !creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newComunicazione')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.stato')}
          <select
            className={SELECT_CLASS}
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value as StatoFilter)}
          >
            <option value="aperte">{t('filterStato.aperte')}</option>
            <option value="chiuse">{t('filterStato.chiuse')}</option>
            <option value="tutte">{t('filterStato.tutte')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filterDaPrendere}
            onChange={(e) => setFilterDaPrendere(e.target.checked)}
          />
          <span>{t('filters.daPrendere')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filterUrgente}
            onChange={(e) => setFilterUrgente(e.target.checked)}
          />
          <span>{t('filters.urgente')}</span>
        </label>
      </div>

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

      {creating && (
        <Card>
          <CardContent className="pt-6">
            {createError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <NuovaComunicazioneForm
              aziende={aziende}
              onSubmit={handleCreate}
              onCancel={() => {
                setCreating(false);
                setCreateError(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((c) => {
              const az = aziendaById.get(c.aziendaId);
              return (
                <li key={c.id}>
                  <Link
                    href={`/t/${slug}/comunicazioni/${c.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-sm hover:bg-accent"
                  >
                    {c.urgente && (
                      <AlertTriangle
                        className="h-4 w-4 shrink-0 text-destructive"
                        aria-label={t('urgente')}
                      />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">{c.codice}</span>
                    <span className="font-medium">{c.oggetto}</span>
                    {az && <span className="text-xs text-muted-foreground">{az.nome}</span>}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        c.operatoreAssegnatoId
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-amber-100 text-amber-800',
                      )}
                    >
                      {c.operatoreAssegnatoId ? t('assegnata') : t('daPrendere')}
                    </span>
                    {c.chiusa && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t('chiusa')}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dateFmt.format(new Date(c.updatedAt))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
