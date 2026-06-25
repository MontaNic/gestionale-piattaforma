'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, FileSignature } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { PreventivoForm } from '@/components/preventivi/PreventivoForm';
import { getPreventivo } from '@/lib/preventivi-api';
import { createMandatoFromPreventivo } from '@/lib/mandati-api';
import { messageForError } from '@/lib/error-codes';
import type { PreventivoWithVoci } from '@/lib/preventivi-types';

// =============================================================================
// preventivi/[preventivoId]/page.tsx — Edit preventivo (STOP-e2 ADR-0037)
// =============================================================================
// Fetch del preventivo con voci (getPreventivo) → editor in modalità edit.
// 404/errore → Alert + retry + link ritorno alla detail cliente. Client
// component: stato React locale, no react-query (convenzione accountant-web).
// =============================================================================

export default function EditPreventivoPage(): JSX.Element {
  const t = useTranslations('preventivi');
  const params = useParams<{ slug: string; id: string; preventivoId: string }>();
  const { slug, id, preventivoId } = params;
  const router = useRouter();
  const { permissions } = useAuth();
  const canManageMandati = permissions.includes('mandati.gestisci');

  const [preventivo, setPreventivo] = useState<PreventivoWithVoci | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creatingMandato, setCreatingMandato] = useState(false);
  const [mandatoError, setMandatoError] = useState<string | null>(null);

  async function handleCreaMandato(): Promise<void> {
    setCreatingMandato(true);
    setMandatoError(null);
    try {
      const mandato = await createMandatoFromPreventivo(preventivoId);
      router.push(`/t/${slug}/mandati/${mandato.id}`);
    } catch (err) {
      setMandatoError(messageForError(err));
      setCreatingMandato(false);
    }
  }

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPreventivo(await getPreventivo(id, preventivoId));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id, preventivoId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${slug}/clienti/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToCliente')}
      </Link>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : loadError || !preventivo ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError ?? t('notFound')}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">
            {t('editTitle', { codice: preventivo.codice })}
          </h1>

          {/* Azione mandato (ADR-0051): da preventivo accettato → crea mandato. */}
          {preventivo.stato === 'accettato' && canManageMandati && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-4">
              <div className="space-y-0.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <FileSignature className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Preventivo accettato
                </p>
                <p className="text-xs text-muted-foreground">
                  Crea il mandato (lettera d&apos;incarico) da questo preventivo.
                </p>
                {mandatoError && <p className="text-xs text-destructive">{mandatoError}</p>}
              </div>
              <Button
                type="button"
                onClick={() => void handleCreaMandato()}
                disabled={creatingMandato}
              >
                {creatingMandato ? 'Creazione…' : 'Crea mandato'}
              </Button>
            </div>
          )}

          {preventivo.stato === 'convertito' && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>Questo preventivo è stato convertito in mandato.</span>
                <Link
                  href={`/t/${slug}/mandati`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Vai ai mandati
                </Link>
              </AlertDescription>
            </Alert>
          )}

          <PreventivoForm aziendaId={id} slug={slug} mode="edit" preventivo={preventivo} />
        </>
      )}
    </div>
  );
}
