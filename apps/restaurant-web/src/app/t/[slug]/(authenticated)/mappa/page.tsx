'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  cn,
} from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import { TableForm } from '@/components/tavoli/TableForm';
import { messageForError } from '@/lib/error-codes';
import { createTable, deleteTable, listTables, updateTable } from '@/lib/table-api';
import type { CreateTableInput, Tavolo } from '@/lib/table-types';

// =============================================================================
// mappa/page.tsx — Mappa sala drag-drop (F2 Tavoli, ADR-0058)
// =============================================================================
// Sostituisce <PlaceholderPage section="mappa">. Pattern FE nuovo da validare:
// persistenza coordinate. Client component (pattern menu/page.tsx): fetch via
// table-api, stato React locale, refetch on mutation (no react-query).
//
// Drag-drop: i tavoli sono token assoluti a posX/posY dentro la canvas. Il drag
// (pointer events) aggiorna lo stato ottimistico; al rilascio (on-drop) persiste
// via PATCH /tables/:id; su errore ricarica dal server (rollback). Gating: drag
// e CRUD solo con `tavoli.gestisci`.
//
// Responsive + a11y: la canvas ha min-width e scrolla orizzontalmente su mobile
// (degrada a scroll, non a griglia). Il drag è pointer-only → l'ELENCO sotto la
// canvas è la superficie CRUD accessibile da tastiera/AT (Modifica/Elimina come
// <button>), valida anche da mobile. (ADR-0058 §a11y/responsive.)
// =============================================================================

const TOKEN_W = 104; // larghezza token tavolo (px)
const TOKEN_H = 76; // altezza token tavolo (px)
const CANVAS_H = 520; // altezza canvas (px)
const CANVAS_MIN_W = 760; // min-width canvas → scroll orizzontale su mobile

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const { permissions } = useAuth();
  const canManage = permissions.includes('tavoli.gestisci');

  const [tables, setTables] = useState<Tavolo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tavolo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tavolo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setTables(await listTables());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (!drag || !drag.moved) return; // semplice tap senza spostamento → no-op
    setActionError(null);
    try {
      await updateTable(drag.id, { posX: Math.round(drag.lastX), posY: Math.round(drag.lastY) });
    } catch (err) {
      setActionError(messageForError(err));
      await load(); // rollback alla posizione server
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
              {tables.map((tavolo) => (
                <div
                  key={tavolo.id}
                  data-testid={`tavolo-${tavolo.id}`}
                  onPointerDown={(e) => handlePointerDown(e, tavolo)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={() => void handlePointerUp()}
                  className={cn(
                    'absolute flex select-none flex-col items-center justify-center rounded-lg border bg-card p-2 text-center shadow-sm',
                    canManage ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default',
                  )}
                  style={{ left: tavolo.posX, top: tavolo.posY, width: TOKEN_W, height: TOKEN_H }}
                >
                  <span className="text-sm font-semibold leading-tight">{tavolo.numero}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {t('seats', { count: tavolo.capienza })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Elenco accessibile: superficie CRUD da tastiera/AT + mobile. */}
          <section className="space-y-2" aria-label={t('listAriaLabel')}>
            <h2 className="text-sm font-medium text-muted-foreground">{t('listTitle')}</h2>
            <ul className="divide-y rounded-lg border">
              {tables.map((tavolo) => (
                <li key={tavolo.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{tavolo.numero}</span>
                    <span className="text-muted-foreground">
                      · {t('seats', { count: tavolo.capienza })}
                    </span>
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
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
                    </span>
                  )}
                </li>
              ))}
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
