'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Megaphone } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { getPortaleCircolari } from '@/lib/portale-circolari-api';
import type { PortaleCircolareListItem } from '@/lib/portale-circolari-api';

// =============================================================================
// portale/circolari/page.tsx — Circolari del cliente (lista, ADR-0048)
// =============================================================================
// Lista delle circolari pubblicate indirizzate alla propria azienda: titolo +
// oggetto + badge "Da leggere" (non ancora aperta) e "Conferma richiesta"
// (richiedeConferma e non confermata). Click → dettaglio. Lo scoping per-azienda
// e il filtro stato=pubblicata sono applicati dal backend; il FE consuma la vista
// già filtrata. Stringhe in italiano (superficie portale single-locale).
// =============================================================================

export default function PortaleCircolariPage(): JSX.Element {
  const locale = useLocale();
  const { slug } = useParams<{ slug: string }>();
  const [items, setItems] = useState<PortaleCircolareListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(await getPortaleCircolari());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Le mie circolari</h1>
        <p className="text-sm text-muted-foreground">
          Comunicazioni e avvisi pubblicati dal tuo studio. Apri una circolare per leggerla.
        </p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : items.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">Nessuna circolare disponibile.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/t/${slug}/portale/circolari/${c.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                >
                  <Megaphone
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className={c.letta ? 'font-medium' : 'font-semibold'}>{c.titolo}</span>
                  {!c.letta && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      Da leggere
                    </span>
                  )}
                  {c.richiedeConferma && !c.confermata && (
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                      Conferma richiesta
                    </span>
                  )}
                  {c.pubblicataIl && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dateFmt.format(new Date(c.pubblicataIl))}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
