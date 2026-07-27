'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';

import { Alert, AlertDescription, Button, Input, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ApiError } from '@gestionale/api-client';

import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import {
  chiudiConto,
  getConto,
  mapRiepilogoIva,
  registraPagamento,
  stornaPagamento,
} from '@/lib/conti-api';
import { getTable } from '@/lib/table-api';
import { METODI_PAGAMENTO } from '@/lib/conti-types';
import type {
  ContoWithRighe,
  MetodoPagamentoConto,
  Pagamento,
  RiepilogoIvaGruppo,
} from '@/lib/conti-types';
import { messageForError } from '@/lib/error-codes';
import { formatEuro } from '@/lib/format';

// =============================================================================
// cassa/[contoId]/page.tsx — Pannello di pagamento (PR2, ADR-0082)
// =============================================================================
// Incasso di un conto: righe in sola lettura, riepilogo IVA, registrazione
// pagamenti (split nativo), storno per riga, chiusura. La gestione delle righe
// resta in `comande/[contoId]`: qui non si tocca il contenuto del conto.
//
// Dati: `getConto` (unica fonte di `residuo`/`statoPagamento`/`chiudibile`) con
// refetch integrale dopo ogni mutazione — nessuna delle rotte pagamento
// restituisce il conto aggiornato. Pattern pessimistico, nessun polling (D1).
//
// ⚠️ CHIUSURA (D2): il bottone è legato a `conto.chiudibile`, campo derivato dal
// BE con LO STESSO predicato della guardia (ADR-0082). Non ricalcolarlo da
// `residuo === 0`: un conto sovra-pagato ha `statoPagamento: 'saldato'` e
// `residuo < 0` ma NON è chiudibile — la UI mostrerebbe un bottone che il BE
// rifiuta con 409. E per lo stesso motivo il bottone non viene mai reso
// disabilitato-in-silenzio: se non è chiudibile, al suo posto compare il motivo
// e la via d'uscita (D3).
// =============================================================================

/** Importo valido per il DTO BE: > 0, massimo 2 decimali (Decimal(10,2)). */
const IMPORTO_PATTERN = /^\d+([.,]\d{1,2})?$/;

function parseImporto(raw: string): number | null {
  const trimmed = raw.trim();
  if (!IMPORTO_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default function CassaContoPage(): JSX.Element {
  const t = useTranslations('cassa');
  const tc = useTranslations('comande');
  const { tenant, permissions } = useAuth();
  const params = useParams<{ contoId: string }>();
  const contoId = params.contoId;

  const canView = permissions.includes('cassa.visualizza');
  const canPay = permissions.includes('cassa.pagamento.registra');
  const canStorna = permissions.includes('cassa.storno.esegui');
  // La chiusura resta su `comande.modifica` (ADR-0081 D5: la guardia di saldo non
  // ha spostato la permission della rotta `chiudi`).
  const canChiudi = permissions.includes('comande.modifica');

  const [conto, setConto] = useState<ContoWithRighe | null>(null);
  const [tavoloLabel, setTavoloLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<MetodoPagamentoConto>('contanti');
  const [importo, setImporto] = useState('');
  const [pendingStorno, setPendingStorno] = useState<Pagamento | null>(null);
  const [pendingChiudi, setPendingChiudi] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const fetched = await getConto(contoId);
      setConto(fetched);
      // Importo pre-compilato col residuo (D4): il caso dominante è "paga tutto".
      // Si riallinea a ogni load — dopo un parziale il campo mostra il nuovo
      // residuo, dopo uno storno torna a coprire l'intero riaperto.
      setImporto(fetched.residuo > 0 ? fetched.residuo.toFixed(2) : '');
      if (fetched.tavoloId) {
        try {
          const tavolo = await getTable(fetched.tavoloId);
          setTavoloLabel(tavolo.numero);
        } catch {
          setTavoloLabel(null);
        }
      } else {
        setTavoloLabel(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(messageForError(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, [contoId]);

  useEffect(() => {
    if (canView) void load();
    else setIsLoading(false);
  }, [canView, load]);

  async function handleRegistraPagamento(): Promise<void> {
    const value = parseImporto(importo);
    if (value === null) return;
    setActionError(null);
    setIsPending(true);
    try {
      await registraPagamento(contoId, { metodo, importo: value });
      await load();
    } catch (err) {
      // L'autorità sul tetto resta il BE: E_PAGAMENTO_EXCEEDS_RESIDUO arriva qui
      // se il residuo è cambiato sotto (altro operatore) nonostante il cap UX.
      setActionError(messageForError(err));
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmStorno(): Promise<void> {
    if (!pendingStorno) return;
    setActionError(null);
    setIsPending(true);
    try {
      await stornaPagamento(contoId, pendingStorno.id);
      setPendingStorno(null);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
      setPendingStorno(null);
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmChiudi(): Promise<void> {
    setActionError(null);
    setIsPending(true);
    try {
      await chiudiConto(contoId);
      setPendingChiudi(false);
      // Refetch invece di redirect: il conto chiuso mostra il riepilogo IVA
      // congelato (D4), che è la prova a schermo dell'incasso appena fatto.
      await load();
    } catch (err) {
      setActionError(messageForError(err));
      setPendingChiudi(false);
    } finally {
      setIsPending(false);
    }
  }

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Alert variant="destructive">
          <AlertDescription>{t('noAccess')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isOpen = conto?.stato === 'aperto';
  // Sul conto chiuso il riepilogo mostrato è lo SNAPSHOT congelato (D4), non il
  // derivato live: è il documento fiscale della chiusura. Su `annullato` (o su un
  // chiuso pre-migration) lo snapshot è NULL → si ricade sul derivato.
  const snapshot = conto?.riepilogoIvaSnapshot?.map(mapRiepilogoIva) ?? null;
  const isSnapshot = conto !== null && !isOpen && snapshot !== null;
  const riepilogo: RiepilogoIvaGruppo[] = isSnapshot
    ? (snapshot ?? [])
    : (conto?.riepilogoIva ?? []);
  const importoValue = parseImporto(importo);
  // Cap SOFT sul residuo: evita il 409 nel caso normale, ma non è la guardia —
  // quella è il BE (E_PAGAMENTO_EXCEEDS_RESIDUO), gestito in `handleRegistra`.
  const importoOverResiduo =
    conto !== null && importoValue !== null && importoValue > conto.residuo;
  const canSubmitPagamento =
    conto !== null && importoValue !== null && !importoOverResiduo && !isPending;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${tenant.slug}/cassa`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('detail.backToList')}
      </Link>

      {isLoading && conto === null && (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      )}

      {notFound && (
        <Alert variant="destructive">
          <AlertDescription>{t('detail.notFound')}</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {conto && (
        <>
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">{t(`channel.${conto.channel}`)}</h1>
              <p className="text-sm text-muted-foreground">
                {conto.tavoloId ? `${t('tavolo')} ${tavoloLabel ?? conto.tavoloId}` : t('noTavolo')}
                {conto.coperti != null && ` · ${t('coperti')}: ${conto.coperti}`}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                isOpen
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {t(`stato.${conto.stato}`)}
            </span>
          </div>

          {!isOpen && (
            <Alert>
              <AlertDescription>
                {t('detail.readOnly', { stato: t(`stato.${conto.stato}`) })}
              </AlertDescription>
            </Alert>
          )}

          {actionError && (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          {/* ── Righe (sola lettura: si modificano da Comande) ─────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('detail.righeTitle')}</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/t/${tenant.slug}/comande/${conto.id}`}>{t('detail.vaiAlConto')}</Link>
              </Button>
            </div>
            {conto.righe.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.righeEmpty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {conto.righe.map((riga) => {
                  const struck = riga.stornata ? 'line-through text-muted-foreground' : '';
                  return (
                    <li key={riga.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className={`truncate font-medium ${struck}`}>{riga.nomeArticolo}</p>
                        <p className={`text-xs text-muted-foreground ${struck}`}>
                          {formatEuro(riga.prezzoUnitario)} · {t('detail.quantita')} {riga.quantita}
                        </p>
                        {riga.stornata && (
                          <span className="inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            {t('pagamenti.stornato')}
                          </span>
                        )}
                      </div>
                      <span
                        className={`w-24 shrink-0 text-right font-medium tabular-nums ${struck}`}
                      >
                        {formatEuro(riga.prezzoUnitario * riga.quantita)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Riepilogo IVA (live su aperto, congelato su chiuso) ─────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {isSnapshot ? t('riepilogo.titleSnapshot') : t('riepilogo.title')}
            </h2>
            {riepilogo.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('riepilogo.empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border" data-testid="cassa-riepilogo-iva">
                <li className="flex items-center gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="flex-1">{t('riepilogo.aliquota')}</span>
                  <span className="w-24 text-right">{t('riepilogo.imponibile')}</span>
                  <span className="w-24 text-right">{t('riepilogo.iva')}</span>
                  <span className="w-24 text-right">{t('riepilogo.lordo')}</span>
                </li>
                {riepilogo.map((gruppo) => (
                  <li
                    key={gruppo.vatPercent}
                    className="flex items-center gap-3 px-3 py-2 text-sm tabular-nums"
                  >
                    <span className="flex-1">{gruppo.vatPercent}%</span>
                    <span className="w-24 text-right">{formatEuro(gruppo.imponibile)}</span>
                    <span className="w-24 text-right">{formatEuro(gruppo.iva)}</span>
                    <span className="w-24 text-right font-medium">{formatEuro(gruppo.lordo)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Saldo ──────────────────────────────────────────────────────── */}
          <div className="space-y-2 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('totale')}</span>
              <span className="tabular-nums">{formatEuro(conto.totale)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-semibold">{t('residuo')}</span>
              <span className="text-lg font-semibold tabular-nums" data-testid="cassa-residuo">
                {formatEuro(conto.residuo)}
              </span>
            </div>
            {/* Su residuo NEGATIVO la didascalia di `statoPagamento` ('saldato' →
                "nulla da incassare") contraddirebbe a colpo d'occhio il segno
                meno: lì parla il blocco sovra-pagato, che dice anche cosa fare. */}
            {conto.residuo >= 0 && (
              <p className="text-xs text-muted-foreground">
                {t(`statoPagamento.${conto.statoPagamento}`)}
              </p>
            )}
          </div>

          {/* ── Registrazione pagamento ────────────────────────────────────── */}
          {isOpen && canPay && conto.residuo > 0 && (
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-lg font-semibold">{t('pagamento.title')}</h2>

              {/* Metodo segmentato (D4): touch-first, 3 target grandi — non un
                  <select>, che su tablet costa un passaggio in più. */}
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('pagamento.metodoLabel')}</p>
                <div className="flex gap-2" role="group" aria-label={t('pagamento.metodoLabel')}>
                  {METODI_PAGAMENTO.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant={metodo === m ? 'default' : 'outline'}
                      aria-pressed={metodo === m}
                      onClick={() => setMetodo(m)}
                      disabled={isPending}
                    >
                      {t(`pagamento.metodo.${m}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="cassa-importo">
                  {t('pagamento.importoLabel')}
                </label>
                <Input
                  id="cassa-importo"
                  type="text"
                  inputMode="decimal"
                  value={importo}
                  onChange={(e) => setImporto(e.target.value)}
                  className="tabular-nums"
                  disabled={isPending}
                />
                {importo.trim() !== '' && importoValue === null && (
                  <p className="text-xs text-destructive">{t('pagamento.importoInvalid')}</p>
                )}
                {importoOverResiduo && (
                  <p className="text-xs text-destructive">
                    {t('pagamento.importoOverResiduo', { residuo: formatEuro(conto.residuo) })}
                  </p>
                )}
              </div>

              <Button
                onClick={() => void handleRegistraPagamento()}
                disabled={!canSubmitPagamento}
                data-testid="cassa-registra-pagamento"
              >
                {isPending ? t('pagamento.submitting') : t('pagamento.submit')}
              </Button>
            </section>
          )}

          {/* ── Pagamenti registrati (split come lista, D4) ─────────────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('pagamenti.title')}</h2>
            {conto.pagamenti.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pagamenti.empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border" data-testid="cassa-pagamenti">
                {conto.pagamenti.map((pagamento) => {
                  const struck = pagamento.stornato ? 'line-through text-muted-foreground' : '';
                  return (
                    <li
                      key={pagamento.id}
                      className="flex items-center justify-between gap-3 p-3 text-sm"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className={`font-medium ${struck}`}>
                          {t(`pagamento.metodo.${pagamento.metodo}`)}
                        </p>
                        {pagamento.stornato && (
                          <span className="inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            {t('pagamenti.stornato')}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`w-24 text-right font-medium tabular-nums ${struck}`}>
                          {formatEuro(pagamento.importo)}
                        </span>
                        {/* Lo storno è possibile solo su conto aperto (il BE
                            rifiuta su un terminale) e mai su uno già stornato. */}
                        {isOpen && canStorna && !pagamento.stornato && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setPendingStorno(pagamento)}
                          >
                            {t('pagamenti.storna')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Chiusura (D2/D3) ───────────────────────────────────────────── */}
          {isOpen && (
            <div className="space-y-3 border-t pt-4">
              {conto.chiudibile ? (
                <>
                  <p className="text-sm text-muted-foreground">{t('chiusura.saldato')}</p>
                  {canChiudi && (
                    <Button onClick={() => setPendingChiudi(true)} data-testid="cassa-chiudi">
                      {t('chiusura.chiudi')}
                    </Button>
                  )}
                </>
              ) : conto.residuo > 0 ? (
                // Residuo aperto: il blocco di pagamento sopra È la call-to-action.
                // Nessun bottone chiudi disabilitato — sarebbe un vicolo cieco muto.
                <p className="text-sm font-medium">
                  {t('chiusura.residuoDaIncassare', { importo: formatEuro(conto.residuo) })}
                </p>
              ) : (
                // Sovra-pagato: residuo < 0 con totale > 0 (una riga già pagata è
                // stata stornata). `statoPagamento` dice `saldato`, la guardia no
                // → si dice esplicitamente cosa è successo e come uscirne (D3).
                <Alert data-testid="cassa-sovrapagato">
                  <AlertDescription className="space-y-1">
                    <p className="font-medium">
                      {t('chiusura.sovrapagato', { importo: formatEuro(Math.abs(conto.residuo)) })}
                    </p>
                    <p className="text-sm">{t('chiusura.sovrapagatoHelp')}</p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingStorno !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStorno(null);
        }}
        title={t('confirm.stornaTitle')}
        description={
          pendingStorno
            ? t('confirm.stornaBody', {
                importo: formatEuro(pendingStorno.importo),
                metodo: t(`pagamento.metodo.${pendingStorno.metodo}`),
              })
            : ''
        }
        confirmLabel={tc('confirm.confirmLabel')}
        cancelLabel={tc('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmStorno()}
        isPending={isPending}
      />
      <ConfirmDialog
        open={pendingChiudi}
        onOpenChange={(open) => {
          if (!open) setPendingChiudi(false);
        }}
        title={t('confirm.chiudiTitle')}
        description={t('confirm.chiudiBody')}
        confirmLabel={tc('confirm.confirmLabel')}
        cancelLabel={tc('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmChiudi()}
        isPending={isPending}
      />
    </div>
  );
}
