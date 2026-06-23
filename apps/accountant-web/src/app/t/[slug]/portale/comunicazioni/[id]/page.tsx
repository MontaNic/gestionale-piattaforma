'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowLeft, Paperclip } from 'lucide-react';

import { Alert, AlertDescription, Button, Textarea, cn } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import {
  getPortaleComunicazione,
  markLettoPortaleComunicazione,
  replyPortaleComunicazione,
} from '@/lib/portale-comunicazioni-api';
import type {
  PortaleComMessaggio,
  PortaleComunicazioneDetail,
} from '@/lib/portale-comunicazioni-api';

// =============================================================================
// portale/comunicazioni/[id]/page.tsx — Dettaglio thread cliente (ADR-0047)
// =============================================================================
// Timeline messaggi (studio a sinistra, cliente a destra; note interne mai
// presenti, escluse dal backend) + composer di risposta (lato=cliente forzato
// dal backend). Al load marca come letti dal cliente i messaggi studio. Allegati:
// solo i nomi (download via portale è backlog, ADR-0047 TD-portale-com-allegati).
// Stringhe in italiano (superficie portale single-locale).
// =============================================================================

function latoClass(lato: PortaleComMessaggio['lato']): string {
  return lato === 'cliente'
    ? 'ml-auto max-w-[80%] bg-primary/5 border-primary/20'
    : 'mr-auto max-w-[80%] bg-muted/40';
}

export default function PortaleComunicazioneThreadPage(): JSX.Element {
  const locale = useLocale();
  const { slug, id } = useParams<{ slug: string; id: string }>();

  const [thread, setThread] = useState<PortaleComunicazioneDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testo, setTesto] = useState('');
  const [isSending, setIsSending] = useState(false);

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

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setThread(await getPortaleComunicazione(id));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Marca i messaggi studio come letti dal cliente (best-effort, una volta).
  useEffect(() => {
    void markLettoPortaleComunicazione(id).catch(() => {
      /* non bloccante */
    });
  }, [id]);

  async function handleSend(): Promise<void> {
    const trimmed = testo.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    setActionError(null);
    try {
      await replyPortaleComunicazione(id, trimmed);
      setTesto('');
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    } finally {
      setIsSending(false);
    }
  }

  if (isLoading) {
    return <p className="mx-auto w-full max-w-3xl text-sm text-muted-foreground">Caricamento…</p>;
  }
  if (loadError || !thread) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <BackLink slug={slug} />
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? 'Comunicazione non trovata.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <BackLink slug={slug} />

      <header className="space-y-1 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{thread.codice}</span>
          <h1 className="text-lg font-semibold">{thread.oggetto}</h1>
          {thread.chiusa && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Chiusa
            </span>
          )}
        </div>
      </header>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {thread.messaggi.map((m) => (
          <div key={m.id} className={cn('rounded-md border p-3 text-sm', latoClass(m.lato))}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{m.lato === 'cliente' ? 'Tu' : 'Studio'}</span>
              <span>{dateFmt.format(new Date(m.createdAt))}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.testo}</p>
            {m.allegati.length > 0 && (
              <ul className="mt-2 space-y-1">
                {m.allegati.map((a) => (
                  <li
                    key={a.id}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    {a.nomeOrig}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {thread.chiusa ? (
        <p className="text-sm text-muted-foreground">
          Questa comunicazione è chiusa. Per riaprirla contatta il tuo studio.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <Textarea
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder="Scrivi una risposta…"
            rows={3}
            aria-label="Risposta"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!testo.trim() || isSending}
              onClick={() => void handleSend()}
            >
              {isSending ? 'Invio…' : 'Invia'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink({ slug }: { slug: string }): JSX.Element {
  return (
    <Link
      href={`/t/${slug}/portale/comunicazioni`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Torna alle comunicazioni
    </Link>
  );
}
