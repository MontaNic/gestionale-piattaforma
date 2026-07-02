'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Pencil, Plus, Send, Trash2 } from 'lucide-react';

import { AddRigaForm, type CatalogGroup } from '@/components/comande/AddRigaForm';
import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Input } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ApiError } from '@gestionale/api-client';
import { cn } from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import {
  addRiga,
  annullaConto,
  chiudiConto,
  deleteRiga,
  getConto,
  inviaConto,
  updateRiga,
} from '@/lib/conti-api';
import { listArticlesByCategory, listCategories, listMenus } from '@/lib/menu-api';
import { getTable } from '@/lib/table-api';
import type { AddRigaInput, ContoRiga, ContoWithRighe, PrintDepartment } from '@/lib/conti-types';

// Righe INVIATE raggruppate per comanda. Il GET /conti/:id espone `comandaId` +
// `reparto` sulla riga ma NON il dettaglio comanda (stato/timestamp): si raggruppa
// per comandaId mostrando il reparto delle righe. Il badge stato comanda arriva
// in PR-3 (board KDS) — nessun fetch extra al feed qui.
interface ComandaGroup {
  comandaId: string;
  reparto: PrintDepartment;
  righe: ContoRiga[];
}

function groupInviate(righe: ContoRiga[]): ComandaGroup[] {
  const groups = new Map<string, ComandaGroup>();
  for (const riga of righe) {
    if (riga.comandaId === null) continue;
    const existing = groups.get(riga.comandaId);
    if (existing) {
      existing.righe.push(riga);
    } else {
      groups.set(riga.comandaId, {
        comandaId: riga.comandaId,
        reparto: riga.reparto,
        righe: [riga],
      });
    }
  }
  return [...groups.values()];
}

// =============================================================================
// comande/[contoId]/page.tsx — Vista conto (PR-1, ADR-0067/0068)
// =============================================================================
// Righe (add/edit quantità/storno), totale derivato, chiudi/annulla. Se il conto
// non è `aperto` → sola lettura (nessuna azione mutante). Il catalogo articoli
// per il picker è composto dagli endpoint esistenti (menu→categorie→articoli):
// nessun endpoint "tutti gli articoli" a catalogo esiste in F1.
// =============================================================================

function formatEuro(value: number): string {
  return `€ ${value.toFixed(2)}`;
}

export default function ContoDetailPage(): JSX.Element {
  const t = useTranslations('comande');
  const { tenant, permissions } = useAuth();
  const params = useParams<{ contoId: string }>();
  const contoId = params.contoId;

  const canModify = permissions.includes('comande.modifica');
  const canDelete = permissions.includes('comande.elimina');

  const [conto, setConto] = useState<ContoWithRighe | null>(null);
  // Label tavolo risolta (numero) — fallback all'id grezzo se il fetch fallisce
  // (es. utente senza tavoli.visualizza). Vedi risoluzione in `load`.
  const [tavoloLabel, setTavoloLabel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingRiga, setAddingRiga] = useState(false);
  const [editingRigaId, setEditingRigaId] = useState<string | null>(null);
  const [editQuantita, setEditQuantita] = useState('1');
  const [editNote, setEditNote] = useState('');
  const [pendingStorno, setPendingStorno] = useState<ContoRiga | null>(null);
  const [pendingChiudi, setPendingChiudi] = useState(false);
  const [pendingAnnulla, setPendingAnnulla] = useState(false);
  const [pendingInvia, setPendingInvia] = useState(false);
  const [inviaSuccess, setInviaSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const fetched = await getConto(contoId);
      setConto(fetched);
      // Risolve il numero tavolo per la label (evita di mostrare l'id grezzo).
      // Fetch singolo, solo se il conto ha un tavolo; su errore fallback all'id.
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
      // Catalogo articoli caricato solo se il conto è modificabile (evita chiamate
      // inutili su conti chiusi/annullati in sola lettura).
      if (fetched.stato === 'aperto') {
        const menus = await listMenus();
        const categories = (await Promise.all(menus.map((m) => listCategories(m.id)))).flat();
        const groups = await Promise.all(
          categories.map(async (c) => ({
            categoryId: c.id,
            categoryName: c.name,
            articles: await listArticlesByCategory(c.id),
          })),
        );
        setCatalog(groups.filter((g) => g.articles.length > 0));
      } else {
        setCatalog([]);
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
    void load();
  }, [load]);

  const isOpen = conto?.stato === 'aperto';
  // Split KDS: `comandaId === null` = pending (da inviare, mutabile); valorizzato
  // = inviata (immutabile). Le azioni edit/storno vivono solo sulle pending.
  const pendingRighe = conto?.righe.filter((r) => r.comandaId === null) ?? [];
  const inviateGroups = groupInviate(conto?.righe ?? []);
  const canInvia = isOpen && canModify && pendingRighe.length > 0;

  async function handleAddRiga(input: AddRigaInput): Promise<void> {
    // Rilancia (ApiError) al form: gestisce E_PRICE_AMBIGUOUS come blocco
    // sull'articolo. Il refetch avviene solo dopo un add riuscito.
    await addRiga(contoId, input);
    await load();
    setAddingRiga(false);
  }

  async function handleConfirmInvia(): Promise<void> {
    setActionError(null);
    setInviaSuccess(null);
    setIsPending(true);
    try {
      const comande = await inviaConto(contoId);
      setPendingInvia(false);
      const reparti = comande.map((c) => t(`dept.${c.reparto}`)).join(', ');
      setInviaSuccess(t('invia.success', { count: comande.length, reparti }));
      await load();
    } catch (err) {
      // Difesa: E_COMANDA_NO_RIGHE_PENDING / E_CONTO_NOT_OPEN gestiti come messaggio.
      setActionError(messageForError(err));
      setPendingInvia(false);
    } finally {
      setIsPending(false);
    }
  }

  async function handleSaveRiga(rigaId: string): Promise<void> {
    setActionError(null);
    setIsPending(true);
    try {
      // note: stringa (incl. "" per svuotare) — solo su riga pending. Il BE
      // rifiuta con 409 E_RIGA_ALREADY_SENT una riga già inviata (difesa lato UI:
      // l'editor non è mostrato sulle righe inviate).
      await updateRiga(contoId, rigaId, { quantita: Number(editQuantita), note: editNote.trim() });
      setEditingRigaId(null);
      await load();
    } catch (err) {
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
      await deleteRiga(contoId, pendingStorno.id);
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
      await load();
    } catch (err) {
      setActionError(messageForError(err));
      setPendingChiudi(false);
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmAnnulla(): Promise<void> {
    setActionError(null);
    setIsPending(true);
    try {
      await annullaConto(contoId);
      setPendingAnnulla(false);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
      setPendingAnnulla(false);
    } finally {
      setIsPending(false);
    }
  }

  // Riga PENDING: mutabile (edit quantità + note inline, storno). Le azioni sono
  // gated dai permessi e visibili solo su conto aperto.
  function renderPendingRiga(riga: ContoRiga): JSX.Element {
    const isEditing = editingRigaId === riga.id;
    return (
      <li
        key={riga.id}
        className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-medium">{riga.nomeArticolo}</p>
          <p className="text-xs text-muted-foreground">
            {t('detail.reparto')}: {t(`dept.${riga.reparto}`)} · {formatEuro(riga.prezzoUnitario)}
          </p>
          {!isEditing && riga.note && (
            <p className="text-xs italic text-muted-foreground">
              {t('detail.note')}: {riga.note}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {isEditing ? (
            <>
              <Input
                type="number"
                min={1}
                value={editQuantita}
                onChange={(e) => setEditQuantita(e.target.value)}
                className="h-9 w-20"
                aria-label={t('detail.editQuantita')}
              />
              <Input
                type="text"
                maxLength={200}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder={t('addRiga.notePlaceholder')}
                className="h-9 sm:w-48"
                aria-label={t('detail.note')}
              />
              <Button
                size="sm"
                onClick={() => void handleSaveRiga(riga.id)}
                disabled={isPending || !/^[1-9]\d*$/.test(editQuantita)}
              >
                {t('detail.saveQuantita')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingRigaId(null)}
                disabled={isPending}
              >
                {t('addRiga.cancel')}
              </Button>
            </>
          ) : (
            <>
              <span className="tabular-nums text-sm">
                {t('detail.quantita')}: {riga.quantita}
              </span>
              <span className="w-20 text-right font-medium tabular-nums">
                {formatEuro(riga.prezzoUnitario * riga.quantita)}
              </span>
              {isOpen && canModify && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('detail.editRiga')}
                  onClick={() => {
                    setEditingRigaId(riga.id);
                    setEditQuantita(String(riga.quantita));
                    setEditNote(riga.note ?? '');
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {isOpen && canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('detail.deleteRiga')}
                  onClick={() => setPendingStorno(riga)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  // Riga INVIATA: immutabile (nessuna azione edit/storno — il BE le rifiuta con
  // 409 E_RIGA_ALREADY_SENT, il gate UI evita l'errore). Sola lettura + note.
  function renderInviataRiga(riga: ContoRiga): JSX.Element {
    return (
      <li key={riga.id} className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-medium">{riga.nomeArticolo}</p>
          <p className="text-xs text-muted-foreground">{formatEuro(riga.prezzoUnitario)}</p>
          {riga.note && (
            <p className="text-xs italic text-muted-foreground">
              {t('detail.note')}: {riga.note}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-sm">
            {t('detail.quantita')}: {riga.quantita}
          </span>
          <span className="w-20 text-right font-medium tabular-nums">
            {formatEuro(riga.prezzoUnitario * riga.quantita)}
          </span>
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${tenant.slug}/comande`}
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

          {inviaSuccess && (
            <Alert>
              <AlertDescription>{inviaSuccess}</AlertDescription>
            </Alert>
          )}

          {/* ── Da inviare (righe pending, mutabili) ───────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('detail.pendingTitle')}</h2>
              {isOpen && canModify && !addingRiga && (
                <Button variant="outline" size="sm" onClick={() => setAddingRiga(true)}>
                  <Plus className="h-4 w-4" />
                  {t('addRiga.title')}
                </Button>
              )}
            </div>

            {isOpen && canModify && addingRiga && (
              <AddRigaForm
                catalog={catalog}
                onAdd={handleAddRiga}
                onCancel={() => setAddingRiga(false)}
              />
            )}

            {pendingRighe.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.pendingEmpty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">{pendingRighe.map(renderPendingRiga)}</ul>
            )}

            {/* Invia in cucina: gated `comande.modifica`, attivo solo con ≥1 pending. */}
            {isOpen && canModify && (
              <Button
                variant="default"
                size="sm"
                disabled={!canInvia || isPending}
                onClick={() => setPendingInvia(true)}
              >
                <Send className="h-4 w-4" />
                {t('invia.button')}
              </Button>
            )}
          </section>

          {/* ── Inviate (immutabili, raggruppate per comanda) ──────────────── */}
          {inviateGroups.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">{t('detail.inviateTitle')}</h2>
              <div className="space-y-3">
                {inviateGroups.map((group) => (
                  <div key={group.comandaId} className="rounded-md border">
                    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="text-sm font-medium">{t(`dept.${group.reparto}`)}</span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        {t('invia.sentBadge')}
                      </span>
                    </div>
                    <ul className="divide-y">{group.righe.map(renderInviataRiga)}</ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Totale ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="font-semibold">{t('totale')}</span>
            <span className="text-lg font-semibold tabular-nums">{formatEuro(conto.totale)}</span>
          </div>

          {/* ── Azioni conto ───────────────────────────────────────────────── */}
          {isOpen && canModify && (
            <div className="flex gap-2">
              <Button variant="default" onClick={() => setPendingChiudi(true)}>
                {t('detail.chiudi')}
              </Button>
              <Button variant="outline" onClick={() => setPendingAnnulla(true)}>
                {t('detail.annulla')}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingStorno !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStorno(null);
        }}
        title={t('confirm.stornoTitle')}
        description={
          pendingStorno ? t('confirm.stornoBody', { name: pendingStorno.nomeArticolo }) : ''
        }
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmStorno()}
        isPending={isPending}
      />
      <ConfirmDialog
        open={pendingInvia}
        onOpenChange={(open) => {
          if (!open) setPendingInvia(false);
        }}
        title={t('invia.confirmTitle')}
        description={t('invia.confirmBody', { count: pendingRighe.length })}
        confirmLabel={t('invia.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmInvia()}
        isPending={isPending}
      />
      <ConfirmDialog
        open={pendingChiudi}
        onOpenChange={(open) => {
          if (!open) setPendingChiudi(false);
        }}
        title={t('confirm.chiudiTitle')}
        description={t('confirm.chiudiBody')}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmChiudi()}
        isPending={isPending}
      />
      <ConfirmDialog
        open={pendingAnnulla}
        onOpenChange={(open) => {
          if (!open) setPendingAnnulla(false);
        }}
        title={t('confirm.annullaTitle')}
        description={t('confirm.annullaBody')}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmAnnulla()}
        isPending={isPending}
      />
    </div>
  );
}
