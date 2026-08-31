'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { useAuth } from '@gestionale/auth-web';
import { Alert, AlertDescription, Card, CardContent } from '@gestionale/ui';

import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import { getCircolare, getCircolareReport } from '@/lib/circolari-api';
import type {
  CircolareReportView,
  CircolareStato,
  CircolareWithDestinatari,
} from '@/lib/circolari-types';

// =============================================================================
// circolari/[id]/page.tsx — Dettaglio circolare read-only (ADR-0045)
// =============================================================================
// Mostra testata + destinatari espansi + body HTML. Le azioni (publish/archive/
// edit/delete) restano sulla lista. Solo operatore studio.
// =============================================================================

const STATO_BADGE: Record<CircolareStato, string> = {
  bozza: 'bg-muted text-muted-foreground',
  pubblicata: 'bg-success-soft text-success',
  archiviata: 'bg-warn-soft text-warn',
};

export default function CircolareDetailPage(): JSX.Element {
  const t = useTranslations('circolari');
  const locale = useLocale();
  const params = useParams<{ slug: string; id: string }>();
  const { permissions } = useAuth();
  const canReadReport = permissions.includes('circolari.read_report');

  const [circolare, setCircolare] = useState<CircolareWithDestinatari | null>(null);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [report, setReport] = useState<CircolareReportView | null>(null);
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

  // Report letture: solo se l'utente ha read_report e la circolare non è bozza
  // (una bozza non ha destinatari risolvibili → niente report, ADR-0048 §1).
  useEffect(() => {
    if (!canReadReport || !circolare || circolare.stato === 'bozza') {
      setReport(null);
      return;
    }
    void getCircolareReport(circolare.id)
      .then(setReport)
      .catch(() => {
        /* best-effort: il pannello report resta nascosto */
      });
  }, [canReadReport, circolare]);

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
  const fmtDateTime = (s: string | null): string => (s ? dateTimeFmt.format(new Date(s)) : '—');

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
        <>
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

          {/* Report letture (gated read_report; nascosto su bozza — vedi effect). */}
          {report && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <h2 className="text-sm font-medium">{t('report.title')}</h2>

                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('report.attesi')}</dt>
                    <dd className="text-lg font-semibold">{report.summary.attesi}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('report.letti')}</dt>
                    <dd className="text-lg font-semibold">{report.summary.letti}</dd>
                  </div>
                  {report.richiedeConferma && (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('report.confermati')}</dt>
                      <dd className="text-lg font-semibold">{report.summary.confermati}</dd>
                    </div>
                  )}
                </dl>

                {report.recipients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('report.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">{t('report.colDestinatario')}</th>
                          <th className="py-2 pr-3 font-medium">{t('report.colLetta')}</th>
                          {report.richiedeConferma && (
                            <th className="py-2 font-medium">{t('report.colConfermata')}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {report.recipients.map((r) => (
                          <tr key={r.userId} className="border-b last:border-0">
                            <td className="py-2 pr-3">
                              <div>{r.nome}</div>
                              <div className="text-xs text-muted-foreground">{r.email}</div>
                            </td>
                            <td className="py-2 pr-3">
                              {r.letta ? fmtDateTime(r.lettaAt) : t('report.nonLetta')}
                            </td>
                            {report.richiedeConferma && (
                              <td className="py-2">
                                {r.confermata ? fmtDateTime(r.confermataAt) : '—'}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
