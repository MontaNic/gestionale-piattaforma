'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { CategorieSection } from '@/components/scadenze/CategorieSection';
import { ScadenzaForm } from '@/components/scadenze/ScadenzaForm';
import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import {
  createScadenza,
  deleteScadenza,
  getScadenze,
  getScadenzeCategorie,
  updateScadenza,
} from '@/lib/scadenze-api';
import type { Scadenza, ScadenzaCategoria, ScadenzaFormPayload } from '@/lib/scadenze-types';

// =============================================================================
// scadenze/page.tsx — Calendario fiscale: lista + form scadenze (STOP-scad2)
// =============================================================================
// Client component (pattern clienti/page): fetch via scadenze-api, stato React
// locale, refetch on mutation (no react-query). Backend filtra solo per
// categoria/azienda/attivo/da/a → `visibilità` e `stato` (scaduta/oggi/futura)
// sono filtri client-side. La lista NON porta relazioni embedded: nome azienda e
// colore categoria si risolvono con i lookup di getScadenzeCategorie() +
// listAziende(). Righe raggruppate per mese. Create/edit form inline in Card.
// Soft-delete con ConfirmDialog. Azioni gestione gated su `scadenze.gestisci`.
// =============================================================================

type StatoFilter = 'tutte' | 'attive' | 'scadute' | 'future';
type VisibilitaFilter = 'tutte' | 'globali' | 'azienda';
type StatoBadge = 'scaduta' | 'oggi' | 'futura';

/** Data odierna come YYYY-MM-DD in fuso locale (server Europe/Rome). */
function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function statoBadgeOf(dataScadenza: string, today: string): StatoBadge {
  if (dataScadenza < today) return 'scaduta';
  if (dataScadenza === today) return 'oggi';
  return 'futura';
}

export default function ScadenzePage(): JSX.Element {
  const t = useTranslations('scadenze');
  const locale = useLocale();
  const { permissions } = useAuth();
  const canManage = permissions.includes('scadenze.gestisci');

  const [scadenze, setScadenze] = useState<Scadenza[]>([]);
  const [categorie, setCategorie] = useState<ScadenzaCategoria[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtri: categoria/da/a vanno al backend; stato/visibilità sono client-side.
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterStato, setFilterStato] = useState<StatoFilter>('tutte');
  const [filterVisibilita, setFilterVisibilita] = useState<VisibilitaFilter>('tutte');
  const [filterDa, setFilterDa] = useState('');
  const [filterA, setFilterA] = useState('');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Scadenza | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Scadenza | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const today = todayLocal();

  const SELECT_CLASS =
    'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  // Reference data (categorie + aziende): fetch unico, indipendente dai filtri.
  const loadReference = useCallback(async (): Promise<void> => {
    const [cats, azs] = await Promise.all([getScadenzeCategorie(), listAziende()]);
    setCategorie(cats);
    setAziende(azs);
  }, []);

  // Scadenze: ricarica al cambio dei filtri backend (categoria/da/a).
  const loadScadenze = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setScadenze(
        await getScadenze({
          categoriaId: filterCategoria || undefined,
          da: filterDa || undefined,
          a: filterA || undefined,
        }),
      );
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [filterCategoria, filterDa, filterA]);

  useEffect(() => {
    void loadReference().catch(() => {
      /* reference best-effort: i select restano vuoti, la lista funziona */
    });
  }, [loadReference]);

  useEffect(() => {
    void loadScadenze();
  }, [loadScadenze]);

  const categoriaById = useMemo(() => {
    const m = new Map<string, ScadenzaCategoria>();
    for (const c of categorie) m.set(c.id, c);
    return m;
  }, [categorie]);

  const aziendaById = useMemo(() => {
    const m = new Map<string, Azienda>();
    for (const a of aziende) m.set(a.id, a);
    return m;
  }, [aziende]);

  // Filtri client-side (stato + visibilità) applicati alla lista già fetchata.
  const filtered = useMemo(() => {
    return scadenze.filter((s) => {
      if (filterStato === 'attive' && !s.attivo) return false;
      if (filterStato === 'scadute' && !(s.dataScadenza < today)) return false;
      if (filterStato === 'future' && s.dataScadenza < today) return false;
      if (filterVisibilita === 'globali' && s.visibilita !== 'tutti') return false;
      if (filterVisibilita === 'azienda' && s.visibilita !== 'azienda') return false;
      return true;
    });
  }, [scadenze, filterStato, filterVisibilita, today]);

  // Raggruppamento per mese (YYYY-MM), label localizzata. La lista arriva già
  // ordinata per dataScadenza asc dal backend → i gruppi restano in ordine.
  const groups = useMemo(() => {
    const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const out: Array<{ key: string; label: string; items: Scadenza[] }> = [];
    let current: { key: string; label: string; items: Scadenza[] } | null = null;
    for (const s of filtered) {
      const key = s.dataScadenza.slice(0, 7);
      if (!current || current.key !== key) {
        const ym = key.split('-');
        const y = Number(ym[0]);
        const m = Number(ym[1]);
        const raw = monthFmt.format(new Date(y, m - 1, 1));
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        current = { key, label, items: [] };
        out.push(current);
      }
      current.items.push(s);
    }
    return out;
  }, [filtered, locale]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );
  function formatDate(d: string): string {
    const p = d.split('-');
    return dateFmt.format(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }

  async function handleCreate(input: ScadenzaFormPayload): Promise<void> {
    await createScadenza(input);
    await loadScadenze();
    setCreating(false);
  }

  async function handleUpdate(input: ScadenzaFormPayload): Promise<void> {
    if (!editing) return;
    await updateScadenza(editing.id, input);
    await loadScadenze();
    setEditing(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteScadenza(pendingDelete.id);
    } catch (err) {
      setDeleteError(messageForError(err));
      setPendingDelete(null);
      setIsDeleting(false);
      return;
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await loadScadenze();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canManage && !creating && !editing && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newScadenza')}
          </Button>
        )}
      </header>

      {/* ── Barra filtri ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.categoria')}
          <select
            className={SELECT_CLASS}
            value={filterCategoria}
            onChange={(e) => setFilterCategoria(e.target.value)}
          >
            <option value="">{t('filters.all')}</option>
            {categorie.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.stato')}
          <select
            className={SELECT_CLASS}
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value as StatoFilter)}
          >
            <option value="tutte">{t('filterStato.tutte')}</option>
            <option value="attive">{t('filterStato.attive')}</option>
            <option value="scadute">{t('filterStato.scadute')}</option>
            <option value="future">{t('filterStato.future')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.visibilita')}
          <select
            className={SELECT_CLASS}
            value={filterVisibilita}
            onChange={(e) => setFilterVisibilita(e.target.value as VisibilitaFilter)}
          >
            <option value="tutte">{t('filterVisibilita.tutte')}</option>
            <option value="globali">{t('filterVisibilita.globali')}</option>
            <option value="azienda">{t('filterVisibilita.azienda')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.da')}
          <input
            type="date"
            className={SELECT_CLASS}
            value={filterDa}
            onChange={(e) => setFilterDa(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.a')}
          <input
            type="date"
            className={SELECT_CLASS}
            value={filterA}
            onChange={(e) => setFilterA(e.target.value)}
          />
        </label>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadScadenze()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {deleteError && (
        <Alert variant="destructive">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      {creating && (
        <Card>
          <CardContent className="pt-6">
            <ScadenzaForm
              categorie={categorie}
              aziende={aziende}
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
            />
          </CardContent>
        </Card>
      )}
      {editing && (
        <Card>
          <CardContent className="pt-6">
            <ScadenzaForm
              key={editing.id}
              scadenza={editing}
              categorie={categorie}
              aziende={aziende}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : filtered.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{g.label}</h2>
              <div className="overflow-hidden rounded-md border">
                <ul className="divide-y">
                  {g.items.map((s) => {
                    const cat = s.categoriaId ? categoriaById.get(s.categoriaId) : undefined;
                    const az = s.aziendaId ? aziendaById.get(s.aziendaId) : undefined;
                    const badge = statoBadgeOf(s.dataScadenza, today);
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cat?.colore ?? '#cbd5e1' }}
                          aria-hidden="true"
                        />
                        <span className="font-medium">{s.titolo}</span>
                        <span className="text-muted-foreground">{formatDate(s.dataScadenza)}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t(`visibilita.${s.visibilita}`)}
                        </span>
                        {az && <span className="text-xs text-muted-foreground">{az.nome}</span>}
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            badge === 'scaduta'
                              ? 'bg-destructive/10 text-destructive'
                              : badge === 'oggi'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-secondary text-secondary-foreground',
                          )}
                        >
                          {t(`badge.${badge}`)}
                        </span>
                        {!s.attivo && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {t('inactive')}
                          </span>
                        )}
                        {canManage && (
                          <span className="ml-auto flex items-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t('edit')}
                              onClick={() => {
                                setCreating(false);
                                setEditing(s);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t('delete')}
                              onClick={() => setPendingDelete(s)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      <CategorieSection categorie={categorie} canManage={canManage} onCreated={loadReference} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.title')}
        description={pendingDelete ? t('confirm.body', { titolo: pendingDelete.titolo }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}
