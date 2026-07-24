'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { CalendarioMese } from '@/components/note-spese/CalendarioMese';
import { ElencoNote } from '@/components/note-spese/ElencoNote';
import { NotaSpesaRow } from '@/components/note-spese/NotaSpesaRow';
import { NotaSpesaForm } from '@/components/note-spese/NotaSpesaForm';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import { getMandati, type Mandato } from '@/lib/mandati-api';
import {
  createNotaSpesa,
  deleteAllegato,
  deleteNotaSpesa,
  downloadAllegato,
  getNotaSpesa,
  getNoteSpese,
  inviaNotaSpesa,
  updateNotaSpesa,
  uploadAllegato,
} from '@/lib/note-spese-api';
import type {
  CreateNotaSpesaInput,
  NotaSpesa,
  NotaSpesaDetail,
  TipoAllegatoNotaSpesa,
} from '@/lib/note-spese-types';
import { giornoToDate, meseCorrente, oggiLocale, shiftMese } from '@/lib/note-spese-date';

// =============================================================================
// note-spese/page.tsx — Note spese operatore (ADR-0074/75/76, gated notespese.gestisci)
// =============================================================================
// Client component (pattern documenti/scadenze). Il mese corrente guida il fetch
// (`?mese=YYYY-MM`, DP-4). Toggle calendario ↔ elenco: è preferenza di VISTA, non
// di dato (la query non cambia).
//
// Layout (§8): mobile-first, due colonne da ~860px (viste a sinistra, dettaglio
// giorno a destra) — nessun container fisso 480px su desktop. Sotto 860px la
// navigazione è a stack (DP-3): selezionando un giorno la vista lascia il posto
// al dettaglio, con "indietro" per tornare.
//
// DP-1: il click sul giorno SELEZIONA, non apre il form.
// =============================================================================

type Vista = 'calendario' | 'elenco';

export default function NoteSpesePage(): JSX.Element {
  const t = useTranslations('noteSpese');
  const locale = useLocale();
  const { permissions } = useAuth();
  const canManage = permissions.includes('notespese.gestisci');

  const [mese, setMese] = useState<string>(() => meseCorrente());
  const [vista, setVista] = useState<Vista>('calendario');
  const [giorno, setGiorno] = useState<string | null>(null);

  const [items, setItems] = useState<NotaSpesa[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [mandati, setMandati] = useState<Mandato[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form: `aperto` distingue "nessun form" da "nuova nota" (corrente = null).
  const [formAperto, setFormAperto] = useState(false);
  const [corrente, setCorrente] = useState<NotaSpesaDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(await getNoteSpese({ mese }));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [mese]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Lookup di riferimento: best-effort, la lista resta utilizzabile senza.
    void (async () => {
      const [azs, mds] = await Promise.all([listAziende(), getMandati()]);
      setAziende(azs);
      setMandati(mds);
    })().catch(() => undefined);
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
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        timeZone: 'UTC',
      }),
    [locale],
  );
  const meseFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );

  const totaleMese = useMemo(() => items.reduce((s, n) => s + n.totale, 0), [items]);
  const noteDelGiorno = useMemo(
    () => (giorno ? items.filter((n) => n.data === giorno) : []),
    [items, giorno],
  );

  function vaiAOggi(): void {
    setMese(meseCorrente());
    setGiorno(oggiLocale());
  }

  async function apriNota(id: string): Promise<void> {
    try {
      setCorrente(await getNotaSpesa(id));
      setFormAperto(true);
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  function apriNuova(): void {
    setCorrente(null);
    setFormAperto(true);
  }

  function chiudiForm(): void {
    setFormAperto(false);
    setCorrente(null);
  }

  // Ricarica la nota aperta (dopo upload/delete allegato) + la lista del mese.
  async function refresh(notaId?: string): Promise<void> {
    if (notaId) setCorrente(await getNotaSpesa(notaId));
    await load();
  }

  async function handleSave(input: CreateNotaSpesaInput): Promise<void> {
    // In creazione: dopo il salvataggio la nota esiste → si possono allegare file.
    const salvata = corrente
      ? await updateNotaSpesa(corrente.id, input)
      : await createNotaSpesa(input);
    setCorrente(salvata);
    await load();
  }

  async function handleUpload(tipo: TipoAllegatoNotaSpesa, file: File): Promise<void> {
    if (!corrente) return;
    await uploadAllegato(corrente.id, tipo, file);
    await refresh(corrente.id);
  }

  async function handleDeleteAllegato(allegatoId: string): Promise<void> {
    if (!corrente) return;
    await deleteAllegato(corrente.id, allegatoId);
    await refresh(corrente.id);
  }

  async function handleInvia(): Promise<void> {
    if (!corrente) return;
    // Il BE è l'autorità sul gating: un rifiuto arriva qui come errore mappato.
    setCorrente(await inviaNotaSpesa(corrente.id));
    await load();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!corrente) return;
    setIsDeleting(true);
    try {
      await deleteNotaSpesa(corrente.id);
      chiudiForm();
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setPendingDelete(false);
      setIsDeleting(false);
      await load();
    }
  }

  function cambiaMese(delta: number): void {
    setMese((m) => shiftMese(m, delta));
    setGiorno(null); // il giorno selezionato non appartiene al nuovo mese
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canManage && !formAperto && (
          <Button onClick={apriNuova}>
            <Plus className="h-4 w-4" />
            {t('newNota')}
          </Button>
        )}
      </header>

      {/* Barra mese + toggle vista (DP-4) */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('mese.prev')}
          onClick={() => cambiaMese(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[10rem] text-center text-sm font-semibold capitalize">
          {meseFmt.format(giornoToDate(`${mese}-01`))}
        </span>
        <Button variant="ghost" size="sm" aria-label={t('mese.next')} onClick={() => cambiaMese(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={vaiAOggi}>
          {t('mese.oggi')}
        </Button>

        <span className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t('totaleMese')}{' '}
            <strong className="tabular-nums text-foreground">
              {currencyFmt.format(totaleMese)}
            </strong>
          </span>
          <span className="flex rounded-md border">
            {/* aria-label sempre presente: sotto `sm` la label testuale è nascosta
                e il bottone resterebbe senza nome accessibile. */}
            <Button
              variant={vista === 'calendario' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={vista === 'calendario'}
              aria-label={t('vista.calendario')}
              onClick={() => setVista('calendario')}
            >
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">{t('vista.calendario')}</span>
            </Button>
            <Button
              variant={vista === 'elenco' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={vista === 'elenco'}
              aria-label={t('vista.elenco')}
              onClick={() => setVista('elenco')}
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">{t('vista.elenco')}</span>
            </Button>
          </span>
        </span>
      </div>

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

      {formAperto && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">
              {corrente ? t('modificaNota') : t('nuovaNotaTitolo')}
            </h2>
            <NotaSpesaForm
              nota={corrente}
              // DP-2: la nuova nota eredita il giorno selezionato, altrimenti oggi.
              dataIniziale={giorno ?? oggiLocale()}
              aziende={aziende}
              mandati={mandati}
              onSave={handleSave}
              onUploadAllegato={handleUpload}
              onDeleteAllegato={handleDeleteAllegato}
              onDownloadAllegato={(allegatoId, nome) => {
                if (corrente)
                  void downloadAllegato(corrente.id, allegatoId, nome).catch(() => undefined);
              }}
              onInvia={handleInvia}
              onDelete={() => setPendingDelete(true)}
              onCancel={chiudiForm}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : (
        <div className="grid gap-4 min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {/* Colonna viste — su mobile cede il posto al dettaglio quando c'è una selezione (DP-3) */}
          <div className={giorno ? 'hidden min-[860px]:block' : ''}>
            {items.length === 0 && !loadError ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">{t('empty')}</p>
                </CardContent>
              </Card>
            ) : vista === 'calendario' ? (
              <Card>
                <CardContent className="pt-6">
                  <CalendarioMese
                    mese={mese}
                    note={items}
                    giornoSelezionato={giorno}
                    onSelectGiorno={setGiorno}
                    currencyFmt={currencyFmt}
                  />
                </CardContent>
              </Card>
            ) : (
              <ElencoNote
                note={items}
                currencyFmt={currencyFmt}
                dateFmt={dateFmt}
                aziendaNomeById={aziendaNomeById}
                mandatoCodiceById={mandatoCodiceById}
                onSelectNota={(n) => void apriNota(n.id)}
              />
            )}
          </div>

          {/* Colonna dettaglio giorno (DP-1) */}
          <div className={giorno ? '' : 'hidden min-[860px]:block'}>
            <Card>
              <CardContent className="space-y-3 pt-6">
                {giorno ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold capitalize">
                        {dateFmt.format(giornoToDate(giorno))}
                      </h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-[860px]:hidden"
                        onClick={() => setGiorno(null)}
                      >
                        {t('indietro')}
                      </Button>
                    </div>
                    {noteDelGiorno.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('emptyDay')}</p>
                    ) : (
                      <ul className="divide-y rounded-md border">
                        {noteDelGiorno.map((n) => (
                          <NotaSpesaRow
                            key={n.id}
                            nota={n}
                            currencyFmt={currencyFmt}
                            aziendaNome={n.aziendaId ? aziendaNomeById.get(n.aziendaId) : undefined}
                            mandatoCodice={
                              n.mandatoId ? mandatoCodiceById.get(n.mandatoId) : undefined
                            }
                            onClick={canManage ? () => void apriNota(n.id) : undefined}
                          />
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('selezionaGiorno')}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(false);
        }}
        title={t('confirm.title')}
        description={t('confirm.body')}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />

      {!canManage && <p className="text-xs text-muted-foreground">{t('readOnlyHint')}</p>}
    </div>
  );
}
