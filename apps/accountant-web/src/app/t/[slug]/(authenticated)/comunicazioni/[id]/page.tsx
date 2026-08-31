'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Download, Paperclip } from 'lucide-react';

import { Alert, AlertDescription, Button, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { MessaggioComposer } from '@/components/comunicazioni/MessaggioComposer';
import { messageForError } from '@/lib/error-codes';
import {
  addMessaggio,
  deleteComunicazione,
  downloadAllegato,
  getAiStatus,
  getComunicazione,
  marcaLetto,
  prendiInCarico,
  updateComunicazione,
  uploadAllegato,
} from '@/lib/comunicazioni-api';
import type { ComMessaggio, ComunicazioneThread } from '@/lib/comunicazioni-types';

// =============================================================================
// comunicazioni/[id]/page.tsx — Dettaglio thread (ADR-0043, solo operatore)
// =============================================================================
// Testata (codice/oggetto/stato) + azioni (presa-in-carico, chiudi/riapri,
// elimina) + timeline messaggi (studio a destra, cliente a sinistra, nota
// interna evidenziata) con allegati scaricabili + composer. Al primo load marca
// come letti dallo studio i messaggi cliente non letti.
// =============================================================================

function lateClass(lato: ComMessaggio['lato']): string {
  if (lato === 'interno') return 'mx-auto max-w-[85%] bg-muted';
  if (lato === 'studio') return 'ml-auto max-w-[80%] bg-primary/5 border-primary/20';
  return 'mr-auto max-w-[80%] bg-muted/40';
}

export default function ComunicazioneThreadPage(): JSX.Element {
  const t = useTranslations('comunicazioni');
  const locale = useLocale();
  const params = useParams<{ slug: string; id: string }>();
  const { slug, id } = params;
  const { permissions } = useAuth();
  const canManage = permissions.includes('comunicazioni.gestisci');

  const [thread, setThread] = useState<ComunicazioneThread | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      // Status AI in parallelo al thread; un suo errore non deve bloccare il load.
      const [com, ai] = await Promise.all([
        getComunicazione(id),
        getAiStatus().catch(() => ({ aiEnabled: false })),
      ]);
      setThread(com);
      setAiEnabled(ai.aiEnabled);
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Marca i messaggi cliente come letti dallo studio (best-effort, una volta).
  useEffect(() => {
    void marcaLetto(id).catch(() => {
      /* non bloccante */
    });
  }, [id]);

  async function handleSend(input: {
    testo: string;
    lato: 'studio' | 'interno';
    file?: File;
  }): Promise<void> {
    setActionError(null);
    try {
      const msg = await addMessaggio(id, { testo: input.testo, lato: input.lato });
      if (input.file) {
        await uploadAllegato(msg.id, input.file);
      }
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  async function runAction(fn: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  if (isLoading) {
    return <p className="mx-auto w-full max-w-3xl text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (loadError || !thread) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <BackLink slug={slug} label={t('backToList')} />
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? t('notFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <BackLink slug={slug} label={t('backToList')} />

      <header className="space-y-2 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{thread.codice}</span>
          <h1 className="text-lg font-semibold">{thread.oggetto}</h1>
          {thread.urgente && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {t('urgente')}
            </span>
          )}
          {thread.chiusa && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t('chiusa')}
            </span>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2 pt-1">
            {!thread.operatoreAssegnatoId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runAction(() => prendiInCarico(id))}
              >
                {t('actions.prendi')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void runAction(() => updateComunicazione(id, { chiusa: !thread.chiusa }))
              }
            >
              {thread.chiusa ? t('actions.riapri') : t('actions.chiudi')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void runAction(() => updateComunicazione(id, { urgente: !thread.urgente }))
              }
            >
              {thread.urgente ? t('actions.rimuoviUrgente') : t('actions.segnaUrgente')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => void runAction(() => deleteComunicazione(id))}
            >
              {t('actions.elimina')}
            </Button>
          </div>
        )}
      </header>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {thread.messaggi.map((m) => (
          <div key={m.id} className={cn('rounded-md border p-3 text-sm', lateClass(m.lato))}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{t(`lato.${m.lato}`)}</span>
              <span>{dateFmt.format(new Date(m.createdAt))}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.testo}</p>
            {m.allegati.length > 0 && (
              <ul className="mt-2 space-y-1">
                {m.allegati.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => void downloadAllegato(a.id, a.nomeOrig).catch(() => undefined)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Paperclip className="h-3 w-3" />
                      {a.nomeOrig}
                      <Download className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {canManage && !thread.chiusa && (
        <MessaggioComposer comunicazioneId={id} aiEnabled={aiEnabled} onSend={handleSend} />
      )}
      {thread.chiusa && <p className="text-sm text-muted-foreground">{t('chiusaHint')}</p>}
    </div>
  );
}

function BackLink({ slug, label }: { slug: string; label: string }): JSX.Element {
  return (
    <Link
      href={`/t/${slug}/comunicazioni`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
