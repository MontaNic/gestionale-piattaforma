'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { Alert, AlertDescription, Card, CardContent } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import { getCircolare } from '@/lib/circolari-api';
import type { CircolareStato, CircolareWithDestinatari } from '@/lib/circolari-types';

// =============================================================================
// circolari/[id]/page.tsx — Dettaglio circolare read-only (ADR-0045)
// =============================================================================
// Mostra testata + destinatari espansi + body HTML. Le azioni (publish/archive/
// edit/delete) restano sulla lista. Solo operatore studio.
// =============================================================================

const STATO_BADGE: Record<CircolareStato, string> = {
  bozza: 'bg-muted text-muted-foreground',
  pubblicata: 'bg-green-100 text-green-800',
  archiviata: 'bg-amber-100 text-amber-800',
};

export default function CircolareDetailPage(): JSX.Element {
  const t = useTranslations('circolari');
  const locale = useLocale();
  const params = useParams<{ slug: string; id: string }>();

  const [circolare, setCircolare] = useState<CircolareWithDestinatari | null>(null);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setCircolare(await getCircolare(params.id));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void listAziende()
      .then(setAziende)
      .catch(() => {
        /* best-effort */
      });
  }, []);

  const aziendaById = useMemo(() => {
    const m = new Map<string, Azienda>();
    for (const a of aziende) m.set(a.id, a);
    return m;
  }, [aziende]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );
  const fmtDate = (s: string | null): string => (s ? dateFmt.format(new Date(s)) : '—');

  function destinatarioLabel(tipo: string, aziendaId: string | null): string {
    if (tipo === 'tutti') return t('destTuttiLabel');
    if (tipo === 'azienda' && aziendaId) return aziendaById.get(aziendaId)?.nome ?? aziendaId;
    return tipo;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${params.slug}/circolari`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('detail.back')}
      </Link>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : circolare ? (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">{circolare.titolo}</h1>
                <p className="text-sm text-muted-foreground">{circolare.oggettoEmail}</p>
              </div>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATO_BADGE[circolare.stato]}`}
              >
                {t(`stato.${circolare.stato}`)}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t('table.priorita')}</dt>
                <dd>{circolare.priorita}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('table.pubblicataIl')}</dt>
                <dd>{fmtDate(circolare.pubblicataIl)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('table.scadeIl')}</dt>
                <dd>{fmtDate(circolare.scadeIl)}</dd>
              </div>
            </dl>

            <div>
              <h2 className="mb-1 text-sm font-medium">{t('detail.destinatari')}</h2>
              <ul className="flex flex-wrap gap-2">
                {circolare.destinatari.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {destinatarioLabel(d.tipo, d.aziendaId)}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="mb-1 text-sm font-medium">{t('detail.contenuto')}</h2>
              {/* Body HTML redatto dall'operatore. Reso come testo grezzo per
                  sicurezza nell'MVP (no dangerouslySetInnerHTML finché non c'è
                  sanitizzazione lato server — TD-circolari-render). */}
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm font-sans">
                {circolare.bodyHtml}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
