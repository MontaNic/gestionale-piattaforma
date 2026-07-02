'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ApiError } from '@gestionale/api-client';
import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import { TableForm } from '@/components/tavoli/TableForm';
import { messageForError } from '@/lib/error-codes';
import { createTable, deleteTable, listTables, updateTable } from '@/lib/table-api';
import { createConto, listConti } from '@/lib/conti-api';
import { usePollingRefresh } from '@/lib/usePollingRefresh';
import type { CreateTableInput, Tavolo } from '@/lib/table-types';
import type { Conto } from '@/lib/conti-types';

// =============================================================================
// mappa/page.tsx — Mappa sala drag-drop + integrazione conti (F2 + PR-2 ADR-0068)
// =============================================================================
// F2 (ADR-0058): i tavoli sono token assoluti a posX/posY dentro la canvas; il
// drag (pointer events) persiste le coordinate via PATCH /tables/:id. Gating
// drag/CRUD: `tavoli.gestisci`.
//
// PR-2 (ADR-0068): la mappa deriva lo stato occupato/libero dai conti aperti
// (`listConti({ stato: 'aperto' })` → un solo fetch, non per-tavolo) e permette
// di aprire un conto `cassa` dal tavolo (tap) o navigare al conto aperto. Lo
// stato NON è persistito sul Tavolo (TD-tavolo-stato-forward invariato) — è
// derivato. Aggiornamento a polling leggero (no SSE/WebSocket, fuori scope).
//
// Permessi PR-2 (disaccoppiati da `tavoli.gestisci`):
//   - aprire conto da tavolo libero → `comande.crea`
//   - navigare al conto di un tavolo occupato → `comande.visualizza`
// Un cameriere con `comande.crea` ma senza `tavoli.gestisci` deve poter aprire
// un conto: il tap è indipendente dal gate drag (che early-return su !canManage).
//
// Tap vs drag: il flag `moved` distingue i due gesti. Dopo un drag (moved) il
// click sintetico che segue il pointer-up viene soppresso (`suppressClickRef`)
// così un riposizionamento non apre per errore un conto.
// =============================================================================

const TOKEN_W = 104; // larghezza token tavolo (px)
const TOKEN_H = 76; // altezza token tavolo (px)
const CANVAS_H = 520; // altezza canvas (px)
const CANVAS_MIN_W = 760; // min-width canvas → scroll orizzontale su mobile
const POLL_MS = 20_000; // periodo refetch occupazione (mappa)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deriva la mappa tavoloId→Conto dei conti aperti. In presenza di >1 conto
 * aperto per lo stesso tavolo (dato pre-index o edge), vince il più recente:
 * il backend ordina `apertoIl desc`, quindi il primo incontrato è il più recente.
 */
function buildOccupancy(conti: Conto[]): Map<string, Conto> {
  const map = new Map<string, Conto>();
  for (const conto of conti) {
    if (conto.tavoloId && !map.has(conto.tavoloId)) map.set(conto.tavoloId, conto);
  }
  return map;
}

interface DragState {
  id: string;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  lastX: number;
  lastY: number;
}

export default function MappaPage(): JSX.Element {
  const t = useTranslations('tavoli');
  const router = useRouter();
  const { tenant, permissions } = useAuth();
  const canManage = permissions.includes('tavoli.gestisci');
  const canViewComande = permissions.includes('comande.visualizza');
  const canCreateComande = permissions.includes('comande.crea');

  const [tables, setTables] = useState<Tavolo[]>([]);
  const [occupancy, setOccupancy] = useState<Map<string, Conto>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tavolo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tavolo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Apertura conto da tavolo (dialog): tavolo scelto + coperti opzionali.
  const [openingTavolo, setOpeningTavolo] = useState<Tavolo | null>(null);
  const [coperti, setCoperti] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // ── Fetch (tavoli + occupazione). `silent` = tick di polling: non tocca gli
  //    stati di loading/errore (nessun flash "Caricamento…", errori transitori
  //    ignorati → l'ultimo dato buono resta a schermo). ──────────────────────
  const fetchData = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) {
        setIsLoading(true);
        setLoadError(null);
      }
      try {
        const [tv, conti] = await Promise.all([
          listTables(),
          canViewComande ? listConti({ stato: 'aperto' }) : Promise.resolve<Conto[]>([]),
        ]);
        setTables(tv);
        setOccupancy(buildOccupancy(conti));
      } catch (err) {
        if (!silent) setLoadError(messageForError(err));
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [canViewComande],
  );

  const load = useCallback((): Promise<void> => fetchData(false), [fetchData]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling leggero: refetch on-interval (solo a tab visibile) + on-focus.
  usePollingRefresh(
    useCallback(() => {
      void fetchData(true);
    }, [fetchData]),
    { intervalMs: POLL_MS },
  );

  // ── Drag-drop (pointer events, gated tavoli.gestisci) ──────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, tavolo: Tavolo): void {
    if (!canManage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      id: tavolo.id,
      offsetX: e.clientX - rect.left - tavolo.posX,
      offsetY: e.clientY - rect.top - tavolo.posY,
      moved: false,
      lastX: tavolo.posX,
      lastY: tavolo.posY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - drag.offsetX, 0, rect.width - TOKEN_W);
    const y = clamp(e.clientY - rect.top - drag.offsetY, 0, CANVAS_H - TOKEN_H);
    drag.moved = true;
    drag.lastX = x;
    drag.lastY = y;
    setTables((prev) => prev.map((tv) => (tv.id === drag.id ? { ...tv, posX: x, posY: y } : tv)));
  }

  async function handlePointerUp(): Promise<void> {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return; // tap senza spostamento → lascia partire onClick
    // Drag reale: sopprime il click sintetico che segue il pointer-up (non deve
    // aprire un conto), poi persiste la nuova posizione.
    suppressClickRef.current = true;
    setActionError(null);
    try {
      await updateTable(drag.id, { posX: Math.round(drag.lastX), posY: Math.round(drag.lastY) });
    } catch (err) {
      setActionError(messageForError(err));
      await load(); // rollback alla posizione server
    }
  }

  // ── Tap tavolo → apri conto (libero) / vai al conto (occupato) ──────────────
  function handleTavoloTap(tavolo: Tavolo): void {
    if (suppressClickRef.current) {
      // coda di un drag: consuma la soppressione e ignora questo click.
      suppressClickRef.current = false;
      return;
    }
    void handleTavoloAction(tavolo);
  }

  async function handleTavoloAction(tavolo: Tavolo): Promise<void> {
    const openConto = occupancy.get(tavolo.id);
    if (openConto) {
      if (!canViewComande) return; // no-op senza permesso
      router.push(`/t/${tenant.slug}/comande/${openConto.id}`);
      return;
    }
    if (!canCreateComande) return; // no-op senza permesso
    setOpenError(null);
    setNotice(null);
    setCoperti('');
    setOpeningTavolo(tavolo);
  }

  /** Risolve il conto aperto di un tavolo (per il redirect post-409). null se assente/non leggibile. */
  async function resolveOpenConto(tavoloId: string): Promise<Conto | null> {
    try {
      const list = await listConti({ stato: 'aperto', tavoloId }); // ordinati apertoIl desc
      return list[0] ?? null;
    } catch {
      return null;
    }
  }

  async function handleConfirmOpen(): Promise<void> {
    if (!openingTavolo) return;
    setIsOpening(true);
    setOpenError(null);
    const copertiNum = coperti.trim() === '' ? undefined : Number(coperti);
    try {
      const conto = await createConto({
        channel: 'cassa',
        tavoloId: openingTavolo.id,
        coperti: copertiNum,
      });
      router.push(`/t/${tenant.slug}/comande/${conto.id}`);
    } catch (err) {
      // 409 "tavolo già occupato": redirect al conto esistente (refetch → risolvi).
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.errorCode === 'E_CONTO_TAVOLO_ALREADY_OPEN'
      ) {
        const existing = await resolveOpenConto(openingTavolo.id);
        if (existing) {
          router.push(`/t/${tenant.slug}/comande/${existing.id}`);
          return;
        }
        // conto non risolvibile (permesso mancante o già chiuso): messaggio + refresh
        setOpeningTavolo(null);
        setIsOpening(false);
        setNotice(t('apri.alreadyOpen'));
        void fetchData(true);
        return;
      }
      setOpenError(messageForError(err));
      setIsOpening(false);
    }
  }

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  async function handleCreate(input: CreateTableInput): Promise<void> {
    await createTable(input);
    await load();
    setCreating(false);
  }

  async function handleEdit(input: CreateTableInput): Promise<void> {
    if (!editing) return;
    await updateTable(editing.id, input);
    await load();
    setEditing(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteTable(pendingDelete.id);
    } catch (err) {
      setActionError(messageForError(err));
      setPendingDelete(null);
      setIsDeleting(false);
      return;
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await load();
  }

  const copertiValid = /^([1-9]\d*)?$/.test(coperti.trim());

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newTable')}
          </Button>
        )}
      </header>

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
      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : tables.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          {/* Canvas mappa: scroll orizzontale su mobile (min-width). */}
          <div className="overflow-x-auto rounded-lg border bg-muted/30">
            <div
              ref={canvasRef}
              data-testid="mappa-canvas"
              className="relative"
              style={{ height: CANVAS_H, minWidth: CANVAS_MIN_W }}
              aria-hidden="true"
            >
              {tables.map((tavolo) => {
                const conto = occupancy.get(tavolo.id);
                const occupato = conto != null;
                const clickable = occupato ? canViewComande : canCreateComande;
                return (
                  <div
                    key={tavolo.id}
                    data-testid={`tavolo-${tavolo.id}`}
                    data-occupato={occupato ? 'true' : 'false'}
                    onPointerDown={(e) => handlePointerDown(e, tavolo)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={() => void handlePointerUp()}
                    onClick={() => handleTavoloTap(tavolo)}
                    className={cn(
                      'absolute flex select-none flex-col items-center justify-center rounded-lg border p-2 text-center shadow-sm',
                      occupato ? 'border-primary bg-primary/10 ring-1 ring-primary/40' : 'bg-card',
                      canManage
                        ? 'cursor-grab touch-none active:cursor-grabbing'
                        : clickable
                          ? 'cursor-pointer'
                          : 'cursor-default',
                    )}
                    style={{ left: tavolo.posX, top: tavolo.posY, width: TOKEN_W, height: TOKEN_H }}
                  >
                    <span className="text-sm font-semibold leading-tight">{tavolo.numero}</span>
                    {occupato && conto ? (
                      <span className="mt-0.5 flex flex-col items-center text-xs leading-tight text-primary">
                        <span className="font-medium">{t('stato.occupato')}</span>
                        <span className="text-[11px]">{formatOpenInfo(conto, t)}</span>
                      </span>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {t('seats', { count: tavolo.capienza })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Elenco accessibile: superficie CRUD + azione conto da tastiera/AT. */}
          <section className="space-y-2" aria-label={t('listAriaLabel')}>
            <h2 className="text-sm font-medium text-muted-foreground">{t('listTitle')}</h2>
            <ul className="divide-y rounded-lg border">
              {tables.map((tavolo) => {
                const conto = occupancy.get(tavolo.id);
                const occupato = conto != null;
                const canAct = occupato ? canViewComande : canCreateComande;
                return (
                  <li key={tavolo.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{tavolo.numero}</span>
                      <span className="text-muted-foreground">
                        · {t('seats', { count: tavolo.capienza })}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          occupato
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {occupato ? t('stato.occupato') : t('stato.libero')}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      {canAct && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleTavoloAction(tavolo)}
                          aria-label={t('apri.actionAria', { numero: tavolo.numero })}
                        >
                          {occupato ? t('apri.vai') : t('apri.action')}
                        </Button>
                      )}
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(tavolo)}
                            aria-label={t('editAria', { numero: tavolo.numero })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingDelete(tavolo)}
                            aria-label={t('deleteAria', { numero: tavolo.numero })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('newTable')}</DialogTitle>
          </DialogHeader>
          <TableForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTable')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <TableForm tavolo={editing} onSubmit={handleEdit} onCancel={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/* Apri conto da tavolo (cassa) */}
      <Dialog
        open={openingTavolo !== null}
        onOpenChange={(open) => {
          if (!open && !isOpening) {
            setOpeningTavolo(null);
            setOpenError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openingTavolo ? t('apri.dialogTitle', { numero: openingTavolo.numero }) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('apri.channelFixed')}</p>
            <div className="space-y-2">
              <label htmlFor="apri-coperti" className="text-sm font-medium">
                {t('apri.copertiLabel')}
              </label>
              <Input
                id="apri-coperti"
                type="number"
                min={1}
                placeholder="—"
                value={coperti}
                onChange={(e) => setCoperti(e.target.value)}
              />
            </div>
            {openError && (
              <Alert variant="destructive">
                <AlertDescription>{openError}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => void handleConfirmOpen()}
                disabled={isOpening || !copertiValid}
              >
                {isOpening ? t('apri.opening') : t('apri.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setOpeningTavolo(null);
                  setOpenError(null);
                }}
                disabled={isOpening}
              >
                {t('apri.cancel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.title')}
        description={pendingDelete ? t('confirm.body', { numero: pendingDelete.numero }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}

/** Info compatta sul token occupato: coperti (se noti) + tempo da apertura. */
function formatOpenInfo(conto: Conto, t: ReturnType<typeof useTranslations>): string {
  const parts: string[] = [];
  if (conto.coperti != null) parts.push(t('occupato.coperti', { count: conto.coperti }));
  parts.push(formatElapsed(conto.apertoIl, t));
  return parts.join(' · ');
}

/** Tempo trascorso dall'apertura, formato relativo semplice (min / ore). */
function formatElapsed(apertoIl: string, t: ReturnType<typeof useTranslations>): string {
  const started = new Date(apertoIl).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (minutes < 60) return t('occupato.daMinuti', { count: minutes });
  return t('occupato.daOre', { count: Math.floor(minutes / 60) });
}
