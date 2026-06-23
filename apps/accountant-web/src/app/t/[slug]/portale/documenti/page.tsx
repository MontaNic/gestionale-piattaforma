'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Download, FileText } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { downloadPortaleDocumento, getPortaleDocumenti } from '@/lib/portale-documenti-api';
import type { PortaleDocumento } from '@/lib/portale-documenti-api';

// =============================================================================
// portale/documenti/page.tsx — Documenti del cliente (read-only, ADR-0046)
// =============================================================================
// Prima superficie dati del portale cliente: lista + download dei propri
// documenti (endpoint /portale/documenti, permesso portale.documenti.visualizza).
// Solo lettura — niente upload/elimina (backlog). Lo scoping per-azienda +
// visibilità è applicato dal backend; il FE consuma la vista già filtrata.
// Stringhe in italiano (superficie portale single-locale, come PortaleShell).
// =============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortaleDocumentiPage(): JSX.Element {
  const locale = useLocale();
  const [items, setItems] = useState<PortaleDocumento[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(await getPortaleDocumenti());
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
        <h1 className="text-2xl font-semibold">I miei documenti</h1>
        <p className="text-sm text-muted-foreground">
          Documenti condivisi dal tuo studio. Clicca per scaricarli.
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
        <p className="text-sm text-muted-foreground">Nessun documento disponibile.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{d.nomeOriginale}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                  {d.tipoNome}
                </span>
                <span className="text-xs text-muted-foreground">{formatSize(d.dimensione)}</span>
                <span className="text-xs text-muted-foreground">
                  {dateFmt.format(new Date(d.createdAt))}
                </span>
                <span className="ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Scarica"
                    onClick={() =>
                      void downloadPortaleDocumento(d.id, d.nomeOriginale).catch(() => undefined)
                    }
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
