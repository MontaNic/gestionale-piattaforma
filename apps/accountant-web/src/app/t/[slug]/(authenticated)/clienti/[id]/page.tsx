'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent, cn } from '@gestionale/ui';
import { PreventiviSection } from '@/components/preventivi/PreventiviSection';
import { ReferentiSection } from '@/components/referenti/ReferentiSection';
import { getAzienda } from '@/lib/aziende-api';
import { messageForError } from '@/lib/error-codes';
import type { Azienda } from '@/lib/aziende-types';

// =============================================================================
// clienti/[id]/page.tsx — Detail cliente + referenti (STOP-c3b ADR-0034)
// =============================================================================
// Primo segmento dinamico del verticale accountant. Header azienda read-only
// (fetch via getAzienda) + sezione referenti CRUD inline (ReferentiSection).
// Client component: stato React locale, no react-query. 404 azienda → messaggio
// + link di ritorno alla lista. La Sidebar resta su "Clienti" (active-state
// prefisso, vedi Sidebar.tsx).
// =============================================================================

export default function ClienteDetailPage(): JSX.Element {
  const t = useTranslations('aziende');
  const params = useParams<{ slug: string; id: string }>();
  const { slug, id } = params;

  const [azienda, setAzienda] = useState<Azienda | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setAzienda(await getAzienda(id));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Link
        href={`/t/${slug}/clienti`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : loadError || !azienda ? (
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
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold">{azienda.nome}</h1>
                  <p className="text-sm text-muted-foreground">
                    {azienda.codice} · {t(`tipo.${azienda.tipoCliente}`)}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    azienda.attivo
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {azienda.attivo ? t('active') : t('inactive')}
                </span>
              </div>

              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <DetailField label={t('fields.partitaIva')} value={azienda.partitaIva} />
                <DetailField label={t('fields.codiceFiscale')} value={azienda.codiceFiscale} />
                <DetailField label={t('fields.email')} value={azienda.email} />
                <DetailField label={t('fields.pec')} value={azienda.pec} />
                <DetailField label={t('fields.telefono')} value={azienda.telefono} />
                <DetailField label={t('fields.indirizzo')} value={azienda.indirizzo} />
              </dl>
            </CardContent>
          </Card>

          <ReferentiSection aziendaId={azienda.id} />

          <PreventiviSection aziendaId={azienda.id} />
        </>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}
