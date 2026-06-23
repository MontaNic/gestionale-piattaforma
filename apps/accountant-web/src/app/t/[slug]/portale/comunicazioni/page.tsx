'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { MessageSquare } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { getPortaleComunicazioni } from '@/lib/portale-comunicazioni-api';
import type { PortaleComunicazioneListItem } from '@/lib/portale-comunicazioni-api';

// =============================================================================
// portale/comunicazioni/page.tsx — Comunicazioni del cliente (lista, ADR-0047)
// =============================================================================
// Lista dei thread della propria azienda: oggetto/codice/stato + badge "non
// letti" (messaggi studio non ancora visti). Click → dettaglio (reply). Lo
// scoping per-azienda + esclusione note interne è applicato dal backend.
// Stringhe in italiano (superficie portale single-locale, come PortaleShell).
// =============================================================================

export default function PortaleComunicazioniPage(): JSX.Element {
  const locale = useLocale();
  const { slug } = useParams<{ slug: string }>();
  const [items, setItems] = useState<PortaleComunicazioneListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(await getPortaleComunicazioni());
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
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Le mie comunicazioni</h1>
        <p className="text-sm text-muted-foreground">
          Messaggi con il tuo studio. Apri una comunicazione per leggere e rispondere.
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
        <p className="text-sm text-muted-foreground">Nessuna comunicazione disponibile.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/t/${slug}/portale/comunicazioni/${c.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                >
                  <MessageSquare
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{c.codice}</span>
                  <span className="font-medium">{c.oggetto}</span>
                  {c.chiusa && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Chiusa
                    </span>
                  )}
                  {c.nonLetti > 0 && (
                    <span
                      className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                      aria-label={`${c.nonLetti} non letti`}
                    >
                      {c.nonLetti}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {dateFmt.format(new Date(c.updatedAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
