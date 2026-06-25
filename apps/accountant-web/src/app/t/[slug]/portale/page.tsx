'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Bell, FileText, MessageSquare } from 'lucide-react';

import { Alert, AlertDescription } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { getPortaleComunicazioni } from '@/lib/portale-comunicazioni-api';
import { getPortaleDocumenti } from '@/lib/portale-documenti-api';
import { getPortaleCircolari } from '@/lib/portale-circolari-api';
import type { PortaleComunicazioneListItem } from '@/lib/portale-comunicazioni-api';
import type { PortaleDocumento } from '@/lib/portale-documenti-api';
import type { PortaleCircolareListItem } from '@/lib/portale-circolari-api';

// =============================================================================
// portale/page.tsx — Homepage portale cliente (Onda 2, Task 5)
// =============================================================================
// Aggrega le novità del giorno: comunicazioni non lette, documenti recenti,
// circolari non lette. Dati da 3 fetch parallele (Promise.allSettled — un
// errore su una sezione non blocca le altre). Pattern identico a
// portale/comunicazioni/page.tsx (useCallback + useEffect + loading/error).
// =============================================================================

interface HomeState {
  comunicazioni: PortaleComunicazioneListItem[];
  documenti: PortaleDocumento[];
  circolari: PortaleCircolareListItem[];
  loadError: string | null;
  isLoading: boolean;
}

export default function PortaleHomePage(): JSX.Element {
  const { user } = useAuth();
  const locale = useLocale();
  const { slug } = useParams<{ slug: string }>();

  const [state, setState] = useState<HomeState>({
    comunicazioni: [],
    documenti: [],
    circolari: [],
    loadError: null,
    isLoading: true,
  });

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
      }),
    [locale],
  );

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, isLoading: true, loadError: null }));
    const [comRes, docRes, cirRes] = await Promise.allSettled([
      getPortaleComunicazioni(),
      getPortaleDocumenti(),
      getPortaleCircolari(),
    ]);
    setState({
      comunicazioni:
        comRes.status === 'fulfilled' ? comRes.value.filter((c) => c.nonLetti > 0).slice(0, 5) : [],
      documenti:
        docRes.status === 'fulfilled'
          ? [...docRes.value]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 5)
          : [],
      circolari:
        cirRes.status === 'fulfilled' ? cirRes.value.filter((c) => !c.letta).slice(0, 5) : [],
      loadError:
        comRes.status === 'rejected' && docRes.status === 'rejected' && cirRes.status === 'rejected'
          ? messageForError(comRes.reason)
          : null,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nome = user ? `${user.firstName} ${user.lastName}` : 'Benvenuto';
  const totaleNovita = state.comunicazioni.length + state.circolari.filter((c) => !c.letta).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{nome}</h1>
        <p className="text-sm text-muted-foreground">
          {totaleNovita > 0 ? `Hai ${totaleNovita} novità da leggere.` : 'Sei aggiornato su tutto.'}
        </p>
      </header>

      {state.loadError && (
        <Alert variant="destructive">
          <AlertDescription>{state.loadError}</AlertDescription>
        </Alert>
      )}

      {state.isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : (
        <div className="space-y-8">
          {/* Comunicazioni non lette */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Comunicazioni non lette
              </h2>
              <Link
                href={`/t/${slug}/portale/comunicazioni`}
                className="text-xs text-muted-foreground hover:underline"
              >
                Vedi tutte
              </Link>
            </div>
            {state.comunicazioni.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna comunicazione non letta.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <ul className="divide-y">
                  {state.comunicazioni.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/t/${slug}/portale/comunicazioni/${c.id}`}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="flex-1 font-medium">{c.oggetto}</span>
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          {c.nonLetti}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {dateFmt.format(new Date(c.updatedAt))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Circolari non lette */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Circolari non lette
              </h2>
              <Link
                href={`/t/${slug}/portale/circolari`}
                className="text-xs text-muted-foreground hover:underline"
              >
                Vedi tutte
              </Link>
            </div>
            {state.circolari.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna circolare da leggere.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <ul className="divide-y">
                  {state.circolari.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/t/${slug}/portale/circolari/${c.id}`}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="flex-1 font-medium">{c.titolo}</span>
                        {c.richiedeConferma && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Conferma richiesta
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {c.pubblicataIl ? dateFmt.format(new Date(c.pubblicataIl)) : '—'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Documenti recenti */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Documenti recenti
              </h2>
              <Link
                href={`/t/${slug}/portale/documenti`}
                className="text-xs text-muted-foreground hover:underline"
              >
                Vedi tutti
              </Link>
            </div>
            {state.documenti.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun documento disponibile.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <ul className="divide-y">
                  {state.documenti.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/t/${slug}/portale/documenti`}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="flex-1 font-medium">{d.nomeOriginale}</span>
                        <span className="text-xs text-muted-foreground">{d.tipoNome}</span>
                        <span className="text-xs text-muted-foreground">
                          {dateFmt.format(new Date(d.createdAt))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
