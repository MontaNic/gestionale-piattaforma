'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Input } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import {
  createTariffa,
  deleteTariffa,
  getTariffe,
  getTariffeRoles,
  getTariffeUsers,
  updateTariffa,
  type LookupOption,
  type Tariffa,
} from '@/lib/tariffe-api';

// =============================================================================
// tariffario/page.tsx — Listino tariffe orarie di costo (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// Tariffa = costo orario per RUOLO (default) o UTENTE (override). Deriva
// automaticamente Prestazione.importo (ore × tariffa). Gating: tariffario.
// visualizza per vedere, tariffario.gestisci per gestire (dati sensibili →
// riservati a Socio/Admin). Scope immutabile in modifica. Decimali normalizzati
// a number dall'api-client.
// =============================================================================

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const eurH = (n: number): string => `€ ${n.toFixed(2)}/h`;

type Scope = 'ruolo' | 'utente';

interface TariffaForm {
  scope: Scope;
  roleId: string;
  userId: string;
  tariffaOraria: string;
  attivo: boolean;
  note: string;
}

function emptyForm(): TariffaForm {
  return { scope: 'ruolo', roleId: '', userId: '', tariffaOraria: '0', attivo: true, note: '' };
}

export default function TariffarioPage(): JSX.Element {
  const { permissions } = useAuth();
  const canView = permissions.includes('tariffario.visualizza');
  const canManage = permissions.includes('tariffario.gestisci');

  const [tariffe, setTariffe] = useState<Tariffa[]>([]);
  const [roles, setRoles] = useState<LookupOption[]>([]);
  const [users, setUsers] = useState<LookupOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TariffaForm>(emptyForm());

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      // I lookup richiedono tariffario.gestisci → fetch solo se si può gestire.
      const [t, r, u] = await Promise.all([
        getTariffe(),
        canManage ? getTariffeRoles() : Promise.resolve([]),
        canManage ? getTariffeUsers() : Promise.resolve([]),
      ]);
      setTariffe(t);
      setRoles(r);
      setUsers(u);
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
    setActionError(null);
  }

  function openEdit(t: Tariffa): void {
    setEditingId(t.id);
    setForm({
      scope: t.roleId ? 'ruolo' : 'utente',
      roleId: t.roleId ?? '',
      userId: t.userId ?? '',
      tariffaOraria: String(t.tariffaOraria),
      attivo: t.attivo,
      note: t.note ?? '',
    });
    setFormOpen(true);
    setActionError(null);
  }

  async function submit(): Promise<void> {
    setActionError(null);
    try {
      if (editingId) {
        // Scope immutabile in modifica: solo tariffa/attivo/note.
        await updateTariffa(editingId, {
          tariffaOraria: Number(form.tariffaOraria),
          attivo: form.attivo,
          note: form.note.trim() || undefined,
        });
      } else {
        await createTariffa({
          roleId: form.scope === 'ruolo' ? form.roleId : undefined,
          userId: form.scope === 'utente' ? form.userId : undefined,
          tariffaOraria: Number(form.tariffaOraria),
          note: form.note.trim() || undefined,
        });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  async function remove(t: Tariffa): Promise<void> {
    setActionError(null);
    try {
      await deleteTariffa(t.id);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  function scopeLabel(t: Tariffa): string {
    if (t.roleName) return `Ruolo · ${t.roleName}`;
    if (t.userName) return `Utente · ${t.userName}`;
    return '—';
  }

  const createDisabled =
    (form.scope === 'ruolo' && !form.roleId) || (form.scope === 'utente' && !form.userId);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Alert>
          <AlertDescription>Non hai i permessi per visualizzare il tariffario.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Coins className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          Tariffario orario
        </h1>
        <p className="text-sm text-muted-foreground">
          Costo orario per ruolo (default) o per singolo utente (override). Usato per calcolare
          automaticamente l&apos;importo delle prestazioni (ore × tariffa).
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
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Tariffe</h2>
            {canManage && (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nuova tariffa
              </Button>
            )}
          </div>

          {formOpen && canManage && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Tipo</span>
                  <select
                    className={SELECT_CLASS}
                    value={form.scope}
                    disabled={editingId !== null}
                    onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as Scope }))}
                  >
                    <option value="ruolo">Ruolo</option>
                    <option value="utente">Utente</option>
                  </select>
                </label>

                {form.scope === 'ruolo' ? (
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Ruolo</span>
                    <select
                      className={SELECT_CLASS}
                      value={form.roleId}
                      disabled={editingId !== null}
                      onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                    >
                      <option value="">Seleziona…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Utente</span>
                    <select
                      className={SELECT_CLASS}
                      value={form.userId}
                      disabled={editingId !== null}
                      onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                    >
                      <option value="">Seleziona…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Tariffa oraria (€)</span>
                  <Input
                    inputMode="decimal"
                    value={form.tariffaOraria}
                    onChange={(e) => setForm((f) => ({ ...f, tariffaOraria: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Note</span>
                  <Input
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  />
                </label>
                {editingId && (
                  <label className="flex items-center gap-2 self-end text-sm">
                    <input
                      type="checkbox"
                      checked={form.attivo}
                      onChange={(e) => setForm((f) => ({ ...f, attivo: e.target.checked }))}
                    />
                    <span>Attiva</span>
                  </label>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                  Annulla
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!editingId && createDisabled}
                  onClick={() => void submit()}
                >
                  {editingId ? 'Salva' : 'Crea'}
                </Button>
              </div>
            </div>
          )}

          {tariffe.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Nessuna tariffa. {canManage && 'Aggiungi una tariffa per ruolo o utente.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Ambito</th>
                    <th className="px-3 py-2 text-right">Tariffa</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tariffe.map((t) => (
                    <tr key={t.id} className={t.attivo ? '' : 'opacity-60'}>
                      <td className="px-3 py-2 font-medium">
                        {scopeLabel(t)}
                        {!t.attivo && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            Inattiva
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{eurH(t.tariffaOraria)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.note ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label="Modifica"
                              onClick={() => openEdit(t)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label="Elimina"
                              onClick={() => void remove(t)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
