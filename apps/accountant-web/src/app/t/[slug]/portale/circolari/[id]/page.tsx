'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { confermaPortaleCircolare, getPortaleCircolare } from '@/lib/portale-circolari-api';
import type { PortaleCircolareDetail } from '@/lib/portale-circolari-api';

// =============================================================================
// portale/circolari/[id]/page.tsx — Dettaglio circolare cliente (ADR-0048)
// =============================================================================
// Testata (titolo/oggetto/date) + corpo. Il body è reso come TESTO grezzo
// (whitespace-pre-wrap), niente dangerouslySetInnerHTML finché non c'è
// sanitizzazione server-side (TD-circolari-render). Al GET il backend segna la
// circolare come letta (markLetta on-open). Se richiedeConferma e non ancora
// confermata → bottone "Conferma lettura"; dopo conferma mostra l'avvenuta presa
// visione. Stringhe in italiano (superficie portale single-locale).
// =============================================================================

export default function PortaleCircolareDetailPage(): JSX.Element {
  const locale = useLocale();
  const { slug, id } = useParams<{ slug: string; id: string }>();

  const [circolare, setCircolare] = useState<PortaleCircolareDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setCircolare(await getPortaleCircolare(id));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConferma(): Promise<void> {
    if (isConfirming) return;
    setIsConfirming(true);
    setActionError(null);
    try {
      await confermaPortaleCircolare(id);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    } finally {
      setIsConfirming(false);
    }
  }

  if (isLoading) {
    return <p className="mx-auto w-full max-w-3xl text-sm text-muted-foreground">Caricamento…</p>;
  }
  if (loadError || !circolare) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <BackLink slug={slug} />
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? 'Circolare non trovata.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <BackLink slug={slug} />

      <header className="space-y-1 rounded-md border p-4">
        <h1 className="text-lg font-semibold">{circolare.titolo}</h1>
        <p className="text-sm text-muted-foreground">{circolare.oggettoEmail}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          {circolare.pubblicataIl && (
            <span>Pubblicata il {dateTimeFmt.format(new Date(circolare.pubblicataIl))}</span>
          )}
          {circolare.scadeIl && <span>Scade il {dateFmt.format(new Date(circolare.scadeIl))}</span>}
        </div>
      </header>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <article className="rounded-md border p-4 text-sm">
        {/* Body reso come testo grezzo (TD-circolari-render: no HTML non sanitizzato). */}
        <p className="whitespace-pre-wrap">{circolare.bodyHtml}</p>
      </article>

      {circolare.richiedeConferma &&
        (circolare.confermata ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Hai confermato la lettura di questa circolare.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warn bg-warn-soft p-3">
            <p className="text-sm text-warn">Questa circolare richiede una conferma di lettura.</p>
            <Button size="sm" disabled={isConfirming} onClick={() => void handleConferma()}>
              {isConfirming ? 'Conferma…' : 'Conferma lettura'}
            </Button>
          </div>
        ))}
    </div>
  );
}

function BackLink({ slug }: { slug: string }): JSX.Element {
  return (
    <Link
      href={`/t/${slug}/portale/circolari`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Torna alle circolari
    </Link>
  );
}
