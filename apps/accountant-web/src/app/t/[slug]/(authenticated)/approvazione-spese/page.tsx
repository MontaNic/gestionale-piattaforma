'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Paperclip, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent } from '@gestionale/ui';
import { ApiError } from '@gestionale/api-client';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import { getMandati, type Mandato } from '@/lib/mandati-api';
import {
  approvaNotaSpesa,
  downloadAllegato,
  getNotaSpesa,
  getNoteSpese,
  respingiNotaSpesa,
} from '@/lib/note-spese-api';
import type { NotaSpesa, NotaSpesaDetail, StatoNotaSpesa, UtenteRef } from '@/lib/note-spese-types';
import { STATI_NOTA_SPESA, allegatiMancanti, nomeUtente } from '@/lib/note-spese-types';
import { giornoToDate, meseCorrente, shiftMese } from '@/lib/note-spese-date';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { RespingiDialog } from '@/components/note-spese/RespingiDialog';

// =============================================================================
// approvazione-spese/page.tsx — pannello approvazione (ADR-0078, PR-5)
// =============================================================================
// Vista SEPARATA da quella operatore (PR-4): qui si DECIDE, non si edita. Gated
// su `notespese.approva`. Coda di lavoro = default `stato=inviata`.
//
// Dipendenza da `leggi_tutte`: senza quel permesso il BE forza `userId = self`,
// quindi l'approvatore vedrebbe solo le proprie note — che però non può decidere
// (auto-decisione vietata) → pannello vuoto e inspiegabile. Caso gestito con uno
// stato esplicito invece di una lista vuota muta.
//
// Filtri mappati sui query param di §6 (`stato`, `userId`, `mese`). Le opzioni
// del filtro utente si derivano dagli AUTORI PRESENTI IN CODA (PR-5a), non da
// una lista di tutti gli utenti del tenant: l'insieme utile è quello.
// =============================================================================

const SELECT =
  'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const STATO_CLASS: Record<StatoNotaSpesa, string> = {
  bozza: 'bg-muted text-muted-foreground',
  inviata: 'bg-info-soft text-info',
  approvata: 'bg-success-soft text-success',
  respinta: 'bg-destructive/10 text-destructive',
};

export default function ApprovazioneSpesePage(): JSX.Element {
  const t = useTranslations('approvazioneSpese');
  const tn = useTranslations('noteSpese');
  const locale = useLocale();
  const { permissions, user } = useAuth();
  const canReadAll = permissions.includes('notespese.leggi_tutte');

  const [mese, setMese] = useState<string>(() => meseCorrente());
  const [filtroStato, setFiltroStato] = useState<StatoNotaSpesa | ''>('inviata');
  const [filtroUserId, setFiltroUserId] = useState('');

  const [items, setItems] = useState<NotaSpesa[]>([]);
  const [autori, setAutori] = useState<UtenteRef[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [mandati, setMandati] = useState<Mandato[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dettaglio, setDettaglio] = useState<NotaSpesaDetail | null>(null);
  const [confermaApprova, setConfermaApprova] = useState(false);
  const [apriRespingi, setApriRespingi] = useState(false);
  const [azioneInCorso, setAzioneInCorso] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  // Stato errore SEPARATO da `loadError`: il refetch in coda alla decisione
  // chiama load(), che azzera `loadError` — l'errore dell'azione sparirebbe
  // un istante dopo essere stato scritto (l'utente non vedrebbe nulla).
  const [azioneError, setAzioneError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getNoteSpese({
        mese,
        stato: filtroStato || undefined,
        userId: filtroUserId || undefined,
      });
      setItems(data);
      // Le opzioni del filtro utente si aggiornano solo quando NON stiamo già
      // filtrando per utente, altrimenti collasserebbero all'unico selezionato.
      if (!filtroUserId) {
        const m = new Map<string, UtenteRef>();
        for (const n of data) m.set(n.user.id, n.user);
        setAutori([...m.values()].sort((a, b) => nomeUtente(a).localeCompare(nomeUtente(b))));
      }
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [mese, filtroStato, filtroUserId]);

  useEffect(() => {
    if (canReadAll) void load();
    else setIsLoading(false);
  }, [load, canReadAll]);

  useEffect(() => {
    void (async () => {
      const [azs, mds] = await Promise.all([listAziende(), getMandati()]);
      setAziende(azs);
      setMandati(mds);
    })().catch(() => {
      /* best-effort: i nomi azienda/mandato non si risolvono, la coda resta
         decidibile. NON è un'azione utente — quelle mostrano sempre l'errore. */
    });
  }, []);

  const aziendaNomeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of aziende) m.set(a.id, a.nome);
    return m;
  }, [aziende]);
  const mandatoCodiceById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of mandati) m.set(x.id, x.codice);
    return m;
  }, [mandati]);

  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }),
    [locale],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const meseFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );

  async function apriDettaglio(id: string): Promise<void> {
    setLoadError(null);
    try {
      setDettaglio(await getNotaSpesa(id));
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  /**
   * Errore di un'azione di decisione → messaggio SEMPRE visibile (mai silenzioso).
   * La transizione non consentita è il caso reale della Direzione con più
   * persone: qualcun altro ha già deciso mentre guardavamo la coda. Non lo
   * nascondiamo, lo spieghiamo e riallineiamo la lista.
   */
  async function eseguiDecisione(azione: () => Promise<unknown>): Promise<void> {
    setAzioneInCorso(true);
    setAzioneError(null);
    setEsito(null);
    try {
      await azione();
      setDettaglio(null);
      setEsito(t('esito.ok'));
    } catch (err) {
      const gia = err instanceof ApiError && err.errorCode === 'E_NOTASPESA_INVALID_TRANSITION';
      setAzioneError(gia ? t('esito.giaDecisa') : messageForError(err));
    } finally {
      setAzioneInCorso(false);
      setConfermaApprova(false);
      setApriRespingi(false);
      // Refetch (non rimozione ottimistica): dopo una decisione la coda va
      // riallineata comunque, e in caso di race mostra lo stato vero.
      await load();
    }
  }

  async function scarica(notaId: string, allegatoId: string, nome: string): Promise<void> {
    // Nessun catch silenzioso (TD-fe-errori-silenziati): un download rifiutato
    // deve dirlo, non sparire.
    try {
      await downloadAllegato(notaId, allegatoId, nome);
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  // Senza leggi_tutte il pannello non può funzionare: stato esplicito.
  if (!canReadAll) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Alert>
          <AlertDescription>
            <strong>{t('serveLeggiTutte.titolo')}</strong>
            <br />
            {t('serveLeggiTutte.corpo')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Filtri: stato / utente / periodo → query param §6 */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filtri.stato')}
          <select
            className={SELECT}
            value={filtroStato}
            onChange={(e) => setFiltroStato(e.target.value as StatoNotaSpesa | '')}
          >
            <option value="">{t('filtri.tutti')}</option>
            {STATI_NOTA_SPESA.map((s) => (
              <option key={s} value={s}>
                {tn(`stato.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filtri.utente')}
          <select
            className={SELECT}
            value={filtroUserId}
            onChange={(e) => setFiltroUserId(e.target.value)}
          >
            <option value="">{t('filtri.tutti')}</option>
            {autori.map((a) => (
              <option key={a.id} value={a.id}>
                {nomeUtente(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filtri.periodo')}
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setMese((m) => shiftMese(m, -1))}>
              ‹
            </Button>
            <span className="min-w-[9rem] text-center text-sm font-semibold capitalize text-foreground">
              {meseFmt.format(giornoToDate(`${mese}-01`))}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setMese((m) => shiftMese(m, 1))}>
              ›
            </Button>
          </span>
        </label>
        <span className="ml-auto text-sm text-muted-foreground">
          {t('inCoda', { count: items.length })}
        </span>
      </div>

      {esito && (
        <Alert>
          <AlertDescription>{esito}</AlertDescription>
        </Alert>
      )}

      {azioneError && (
        <Alert variant="destructive">
          <AlertDescription>{azioneError}</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {tn('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tn('loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t('nessunaNota')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((n) => {
              const mancanti = allegatiMancanti(n);
              const isPropria = n.user.id === user?.id;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void apriDettaglio(n.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="font-medium">{nomeUtente(n.user)}</span>
                    <span className="text-xs text-muted-foreground">
                      {dateFmt.format(giornoToDate(n.data))}
                    </span>
                    <span>{tn(`tipoSpesa.${n.tipoSpesa}`)}</span>
                    <span className="font-semibold tabular-nums">
                      {currencyFmt.format(n.totale)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATO_CLASS[n.stato]}`}>
                      {tn(`stato.${n.stato}`)}
                    </span>
                    {n.aziendaId && (
                      <span className="text-xs text-muted-foreground">
                        {aziendaNomeById.get(n.aziendaId)}
                      </span>
                    )}
                    {n.mandatoId && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        {mandatoCodiceById.get(n.mandatoId)}
                      </span>
                    )}
                    {n.allegati.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        {n.allegati.length}
                      </span>
                    )}
                    {mancanti.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {mancanti.map((m) => tn(`tipoAllegato.${m}`)).join(', ')}
                      </span>
                    )}
                    {/* Scopo: contesto essenziale per decidere, non solo nel dettaglio. */}
                    <span className="ml-auto max-w-[18rem] truncate text-xs text-muted-foreground">
                      {n.scopoMissione}
                    </span>
                    {isPropria && (
                      <span className="text-xs italic text-muted-foreground">{t('tuaNota')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dettaglio && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{nomeUtente(dettaglio.user)}</h2>
                <p className="text-xs text-muted-foreground">
                  {dateFmt.format(giornoToDate(dettaglio.data))} · {dettaglio.scopoMissione}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDettaglio(null)}>
                {tn('form.chiudi')}
              </Button>
            </div>

            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <Riga label={tn('form.tipoSpesa')} value={tn(`tipoSpesa.${dettaglio.tipoSpesa}`)} />
              <Riga label={tn('form.totale')} value={currencyFmt.format(dettaglio.totale)} />
              <Riga
                label={tn('form.metodoPagamento')}
                value={tn(`metodoPagamento.${dettaglio.metodoPagamento}`)}
              />
              <Riga
                label={tn('form.aliquotaIva')}
                value={tn(`aliquotaIva.${dettaglio.aliquotaIva}`)}
              />
              <Riga
                label={tn('form.deducibilita')}
                value={tn(`deducibilita.${dettaglio.deducibilitaFiscale}`)}
              />
              {dettaglio.aziendaId && (
                <Riga
                  label={tn('form.azienda')}
                  value={aziendaNomeById.get(dettaglio.aziendaId) ?? ''}
                />
              )}
              {dettaglio.mandatoId && (
                <Riga
                  label={tn('form.mandato')}
                  value={mandatoCodiceById.get(dettaglio.mandatoId) ?? ''}
                />
              )}
              {dettaglio.distanzaKm !== null && (
                <Riga label={tn('form.distanzaKm')} value={String(dettaglio.distanzaKm)} />
              )}
              {dettaglio.note && <Riga label={tn('form.note')} value={dettaglio.note} />}
              {dettaglio.decisaDa && (
                <Riga label={t('decisaDa')} value={nomeUtente(dettaglio.decisaDa)} />
              )}
            </dl>

            {/* Allegati: l'approvatore DEVE poterli vedere per decidere. */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('allegati')}</p>
              {dettaglio.allegati.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tn('nessunAllegato')}</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {dettaglio.allegati.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="text-sm underline underline-offset-2"
                        onClick={() => void scarica(dettaglio.id, a.id, a.nomeOriginale)}
                      >
                        {tn(`tipoAllegato.${a.tipo}`)}: {a.nomeOriginale}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Azioni: solo su nota `inviata` e MAI sulle proprie (auto-decisione
                vietata dal BE) — non basta gestire l'errore, l'azione non si mostra. */}
            {dettaglio.stato === 'inviata' &&
              (dettaglio.user.id === user?.id ? (
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {t('nonPuoiDecidereTua')}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={azioneInCorso} onClick={() => setConfermaApprova(true)}>
                    {t('azioni.approva')}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={azioneInCorso}
                    onClick={() => setApriRespingi(true)}
                  >
                    {t('azioni.respingi')}
                  </Button>
                </div>
              ))}

            {dettaglio.motivoRifiuto && (
              <Alert variant="destructive">
                <AlertDescription>
                  <strong>{tn('motivoRifiuto')}</strong> {dettaglio.motivoRifiuto}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={confermaApprova}
        onOpenChange={setConfermaApprova}
        title={t('approva.titolo')}
        description={t('approva.descrizione')}
        confirmLabel={t('azioni.approva')}
        cancelLabel={t('respingi.annulla')}
        onConfirm={() => {
          if (dettaglio) void eseguiDecisione(() => approvaNotaSpesa(dettaglio.id));
        }}
        isPending={azioneInCorso}
      />

      <RespingiDialog
        open={apriRespingi}
        onOpenChange={setApriRespingi}
        autore={dettaglio ? nomeUtente(dettaglio.user) : ''}
        isPending={azioneInCorso}
        onConfirm={async (motivo) => {
          if (dettaglio) await eseguiDecisione(() => respingiNotaSpesa(dettaglio.id, motivo));
        }}
      />
    </div>
  );
}

function Riga({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
