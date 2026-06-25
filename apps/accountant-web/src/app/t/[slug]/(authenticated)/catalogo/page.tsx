'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Input } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { UNITA_MISURA, type UnitaMisura } from '@/lib/preventivi-types';
import {
  createCatalogoCategoria,
  createCatalogoServizio,
  deleteCatalogoCategoria,
  deleteCatalogoServizio,
  getCatalogoCategorie,
  getCatalogoServizi,
  updateCatalogoCategoria,
  updateCatalogoServizio,
  type ServizioCatalogo,
  type ServizioCategoria,
  type TipoRicorrenza,
} from '@/lib/catalogo-api';

// =============================================================================
// catalogo/page.tsx — Catalogo servizi operatore-studio (ADR-0050, Onda 3 Task 1)
// =============================================================================
// Due sezioni: Servizi (primaria) + Categorie. Righe piattaforma (tenantId null)
// sono read-only (badge "Piattaforma", nessuna azione); le custom hanno CRUD
// completo. Gating: servizi.visualizza per vedere, servizi.gestisci per gestire.
// Stringhe IT hardcoded (superficie operatore, scope ADR-0050). Decimali già
// normalizzati a number dall'api-client.
// =============================================================================

const RICORRENZA_OPTS: ReadonlyArray<{ value: TipoRicorrenza; label: string }> = [
  { value: 'una_tantum', label: 'Una tantum' },
  { value: 'mensile', label: 'Mensile' },
  { value: 'annuale', label: 'Annuale' },
];

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const eur = (n: number): string => `€ ${n.toFixed(2)}`;

interface ServizioForm {
  codice: string;
  nome: string;
  descrizione: string;
  categoriaId: string;
  unitaMisura: UnitaMisura;
  prezzoBase: string;
  ivaAliquota: string;
  tipoRicorrenza: TipoRicorrenza;
  attivo: boolean;
}

function emptyServizioForm(): ServizioForm {
  return {
    codice: '',
    nome: '',
    descrizione: '',
    categoriaId: '',
    unitaMisura: 'forfait',
    prezzoBase: '0',
    ivaAliquota: '22',
    tipoRicorrenza: 'una_tantum',
    attivo: true,
  };
}

export default function CatalogoPage(): JSX.Element {
  const { permissions } = useAuth();
  const canView = permissions.includes('servizi.visualizza');
  const canManage = permissions.includes('servizi.gestisci');

  const [categorie, setCategorie] = useState<ServizioCategoria[]>([]);
  const [servizi, setServizi] = useState<ServizioCatalogo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [catFilter, setCatFilter] = useState('');

  // Form servizio (create o edit). editingId null = create.
  const [servizioOpen, setServizioOpen] = useState(false);
  const [editingServizioId, setEditingServizioId] = useState<string | null>(null);
  const [servizioForm, setServizioForm] = useState<ServizioForm>(emptyServizioForm());

  // Form categoria.
  const [catOpen, setCatOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catNome, setCatNome] = useState('');
  const [catColore, setCatColore] = useState('#6366f1');

  const categoriaNome = useMemo(() => {
    const m = new Map(categorie.map((c) => [c.id, c.nome]));
    return (id: string | null): string => (id ? (m.get(id) ?? '—') : '—');
  }, [categorie]);

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [cat, svc] = await Promise.all([getCatalogoCategorie(), getCatalogoServizi()]);
      setCategorie(cat);
      setServizi(svc);
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const serviziFiltrati = catFilter ? servizi.filter((s) => s.categoriaId === catFilter) : servizi;

  // ── Handlers servizio ──────────────────────────────────────────────────────
  function openCreateServizio(): void {
    setEditingServizioId(null);
    setServizioForm(emptyServizioForm());
    setServizioOpen(true);
    setActionError(null);
  }

  function openEditServizio(s: ServizioCatalogo): void {
    setEditingServizioId(s.id);
    setServizioForm({
      codice: s.codice,
      nome: s.nome,
      descrizione: s.descrizione ?? '',
      categoriaId: s.categoriaId ?? '',
      unitaMisura: s.unitaMisura,
      prezzoBase: String(s.prezzoBase),
      ivaAliquota: String(s.ivaAliquota),
      tipoRicorrenza: s.tipoRicorrenza,
      attivo: s.attivo,
    });
    setServizioOpen(true);
    setActionError(null);
  }

  async function submitServizio(): Promise<void> {
    setActionError(null);
    const payload = {
      codice: servizioForm.codice.trim(),
      nome: servizioForm.nome.trim(),
      descrizione: servizioForm.descrizione.trim() || undefined,
      categoriaId: servizioForm.categoriaId || undefined,
      unitaMisura: servizioForm.unitaMisura,
      prezzoBase: Number(servizioForm.prezzoBase),
      ivaAliquota: Number(servizioForm.ivaAliquota),
      tipoRicorrenza: servizioForm.tipoRicorrenza,
      attivo: servizioForm.attivo,
    };
    try {
      if (editingServizioId) {
        await updateCatalogoServizio(editingServizioId, payload);
      } else {
        await createCatalogoServizio(payload);
      }
      setServizioOpen(false);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  async function removeServizio(s: ServizioCatalogo): Promise<void> {
    setActionError(null);
    try {
      await deleteCatalogoServizio(s.id);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  // ── Handlers categoria ─────────────────────────────────────────────────────
  function openCreateCat(): void {
    setEditingCatId(null);
    setCatNome('');
    setCatColore('#6366f1');
    setCatOpen(true);
    setActionError(null);
  }

  function openEditCat(c: ServizioCategoria): void {
    setEditingCatId(c.id);
    setCatNome(c.nome);
    setCatColore(c.colore);
    setCatOpen(true);
    setActionError(null);
  }

  async function submitCat(): Promise<void> {
    setActionError(null);
    const payload = { nome: catNome.trim(), colore: catColore };
    try {
      if (editingCatId) {
        await updateCatalogoCategoria(editingCatId, payload);
      } else {
        await createCatalogoCategoria(payload);
      }
      setCatOpen(false);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  async function removeCat(c: ServizioCategoria): Promise<void> {
    setActionError(null);
    try {
      await deleteCatalogoCategoria(c.id);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Alert>
          <AlertDescription>Non hai i permessi per visualizzare il catalogo.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BookOpen className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          Catalogo servizi
        </h1>
        <p className="text-sm text-muted-foreground">
          Listino servizi dello studio. Le voci di piattaforma sono condivise e in sola lettura;
          puoi aggiungere e gestire le tue voci custom.
        </p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : (
        <>
          {/* ── Servizi ───────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Servizi</h2>
              <div className="flex items-center gap-2">
                <select
                  className={SELECT_CLASS + ' max-w-[14rem]'}
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                >
                  <option value="">Tutte le categorie</option>
                  {categorie.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                {canManage && (
                  <Button type="button" size="sm" onClick={openCreateServizio}>
                    <Plus className="h-4 w-4" />
                    Nuovo servizio
                  </Button>
                )}
              </div>
            </div>

            {servizioOpen && canManage && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Codice</span>
                    <Input
                      value={servizioForm.codice}
                      onChange={(e) => setServizioForm((f) => ({ ...f, codice: e.target.value }))}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Nome</span>
                    <Input
                      value={servizioForm.nome}
                      onChange={(e) => setServizioForm((f) => ({ ...f, nome: e.target.value }))}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Categoria</span>
                    <select
                      className={SELECT_CLASS}
                      value={servizioForm.categoriaId}
                      onChange={(e) =>
                        setServizioForm((f) => ({ ...f, categoriaId: e.target.value }))
                      }
                    >
                      <option value="">Nessuna</option>
                      {categorie.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Unità di misura</span>
                    <select
                      className={SELECT_CLASS}
                      value={servizioForm.unitaMisura}
                      onChange={(e) =>
                        setServizioForm((f) => ({
                          ...f,
                          unitaMisura: e.target.value as UnitaMisura,
                        }))
                      }
                    >
                      {UNITA_MISURA.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Prezzo base</span>
                    <Input
                      inputMode="decimal"
                      value={servizioForm.prezzoBase}
                      onChange={(e) =>
                        setServizioForm((f) => ({ ...f, prezzoBase: e.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>IVA %</span>
                    <Input
                      inputMode="decimal"
                      value={servizioForm.ivaAliquota}
                      onChange={(e) =>
                        setServizioForm((f) => ({ ...f, ivaAliquota: e.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Ricorrenza</span>
                    <select
                      className={SELECT_CLASS}
                      value={servizioForm.tipoRicorrenza}
                      onChange={(e) =>
                        setServizioForm((f) => ({
                          ...f,
                          tipoRicorrenza: e.target.value as TipoRicorrenza,
                        }))
                      }
                    >
                      {RICORRENZA_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 self-end text-sm">
                    <input
                      type="checkbox"
                      checked={servizioForm.attivo}
                      onChange={(e) => setServizioForm((f) => ({ ...f, attivo: e.target.checked }))}
                    />
                    <span>Attivo</span>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setServizioOpen(false)}
                  >
                    Annulla
                  </Button>
                  <Button type="button" size="sm" onClick={() => void submitServizio()}>
                    {editingServizioId ? 'Salva' : 'Crea'}
                  </Button>
                </div>
              </div>
            )}

            {serviziFiltrati.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Nessun servizio.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Codice</th>
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">Categoria</th>
                      <th className="px-3 py-2">UM</th>
                      <th className="px-3 py-2 text-right">Prezzo</th>
                      <th className="px-3 py-2">Ricorrenza</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {serviziFiltrati.map((s) => {
                      const isPlatform = s.tenantId === null;
                      return (
                        <tr key={s.id} className={s.attivo ? '' : 'opacity-60'}>
                          <td className="px-3 py-2 font-mono text-xs">{s.codice}</td>
                          <td className="px-3 py-2 font-medium">
                            {s.nome}
                            {isPlatform && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                Piattaforma
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {categoriaNome(s.categoriaId)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{s.unitaMisura}</td>
                          <td className="px-3 py-2 text-right">{eur(s.prezzoBase)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {RICORRENZA_OPTS.find((o) => o.value === s.tipoRicorrenza)?.label}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canManage && !isPlatform && (
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Modifica"
                                  onClick={() => openEditServizio(s)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Elimina"
                                  onClick={() => void removeServizio(s)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Categorie ─────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Categorie</h2>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={openCreateCat}>
                  <Plus className="h-4 w-4" />
                  Nuova categoria
                </Button>
              )}
            </div>

            {catOpen && canManage && (
              <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-4">
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Nome</span>
                  <Input value={catNome} onChange={(e) => setCatNome(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Colore</span>
                  <input
                    type="color"
                    value={catColore}
                    onChange={(e) => setCatColore(e.target.value)}
                    className="h-9 w-16 rounded-md border"
                  />
                </label>
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCatOpen(false)}>
                    Annulla
                  </Button>
                  <Button type="button" size="sm" onClick={() => void submitCat()}>
                    {editingCatId ? 'Salva' : 'Crea'}
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-md border">
              <ul className="divide-y">
                {categorie.map((c) => {
                  const isPlatform = c.tenantId === null;
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border"
                        style={{ backgroundColor: c.colore }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 font-medium">
                        {c.nome}
                        {isPlatform && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            Piattaforma
                          </span>
                        )}
                      </span>
                      {canManage && !isPlatform && (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Modifica"
                            onClick={() => openEditCat(c)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Elimina"
                            onClick={() => void removeCat(c)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
