'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Input } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import {
  createPrestazione,
  deletePrestazione,
  getPrestazioni,
  updatePrestazione,
  type Prestazione,
} from '@/lib/prestazioni-api';
import type { StatoMandato } from '@/lib/mandati-api';
import type { PreventivoVoce } from '@/lib/preventivi-types';

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// =============================================================================
// PrestazioniSection.tsx — Timesheet embedded nella pagina mandato (ADR-0053)
// =============================================================================
// Lista ore registrate + form aggiungi/modifica + totali (ore, importo). Il
// pulsante "Aggiungi" compare solo se `prestazioni.gestisci` E mandato in_corso
// (mirror del guard BE). Gating sezione: `prestazioni.visualizza`. Classi
// dark-mode-safe (design tokens, ADR-0052). Stringhe i18n (namespace `prestazioni`).
// =============================================================================

interface PrestazioneForm {
  data: string;
  ore: string;
  descrizione: string;
  fatturabile: boolean;
  importo: string;
  note: string;
  voceId: string;
}

function emptyForm(): PrestazioneForm {
  return {
    data: '',
    ore: '',
    descrizione: '',
    fatturabile: true,
    importo: '',
    note: '',
    voceId: '',
  };
}

interface PrestazioniSectionProps {
  mandatoId: string;
  mandatoStato: StatoMandato;
  /** Voci del preventivo d'origine — opzioni del picker "Voce" (ADR-0053 sub-DP). */
  voci: PreventivoVoce[];
}

export function PrestazioniSection({
  mandatoId,
  mandatoStato,
  voci,
}: PrestazioniSectionProps): JSX.Element | null {
  const t = useTranslations('prestazioni');
  const { permissions } = useAuth();
  const canView = permissions.includes('prestazioni.visualizza');
  const canManage = permissions.includes('prestazioni.gestisci');
  const isInCorso = mandatoStato === 'in_corso';

  // Lookup voceId → nome per la colonna "Voce" della tabella.
  const voceNome = useMemo(() => {
    const m = new Map(voci.map((v) => [v.id, v.nome]));
    return (voceId: string | null): string => (voceId ? (m.get(voceId) ?? '—') : '—');
  }, [voci]);

  const [prestazioni, setPrestazioni] = useState<Prestazione[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PrestazioneForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const totali = useMemo(() => {
    const ore = prestazioni.reduce((acc, p) => acc + p.ore, 0);
    const importo = prestazioni.reduce((acc, p) => acc + (p.importo ?? 0), 0);
    return { ore, importo };
  }, [prestazioni]);

  const load = useCallback(async (): Promise<void> => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setPrestazioni(await getPrestazioni(mandatoId));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [canView, mandatoId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return null;

  function openCreate(): void {
    setEditingId(null);
    setForm({ ...emptyForm(), data: new Date().toISOString().slice(0, 10) });
    setOpen(true);
    setActionError(null);
  }

  function openEdit(p: Prestazione): void {
    setEditingId(p.id);
    setForm({
      data: p.data,
      ore: String(p.ore),
      descrizione: p.descrizione,
      fatturabile: p.fatturabile,
      importo: p.importo === null ? '' : String(p.importo),
      note: p.note ?? '',
      voceId: p.voceId ?? '',
    });
    setOpen(true);
    setActionError(null);
  }

  async function submit(): Promise<void> {
    setSaving(true);
    setActionError(null);
    const payload = {
      data: form.data,
      ore: Number(form.ore),
      descrizione: form.descrizione.trim(),
      fatturabile: form.fatturabile,
      importo: form.importo.trim() === '' ? undefined : Number(form.importo),
      note: form.note.trim() || undefined,
      voceId: form.voceId || undefined,
    };
    try {
      if (editingId) {
        await updatePrestazione(mandatoId, editingId, payload);
      } else {
        await createPrestazione(mandatoId, payload);
      }
      setOpen(false);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Prestazione): Promise<void> {
    setActionError(null);
    try {
      await deletePrestazione(mandatoId, p.id);
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage && isInCorso && (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        )}
      </div>

      {!isInCorso && <p className="text-xs text-muted-foreground">{t('readOnlyHint')}</p>}

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

      {open && canManage && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t('fields.data')}</span>
              <Input
                type="date"
                value={form.data}
                onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t('fields.ore')}</span>
              <Input
                inputMode="decimal"
                value={form.ore}
                onChange={(e) => setForm((f) => ({ ...f, ore: e.target.value }))}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
              <span>{t('fields.descrizione')}</span>
              <Input
                value={form.descrizione}
                onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
              <span>{t('fields.voce')}</span>
              <select
                className={SELECT_CLASS}
                value={form.voceId}
                onChange={(e) => setForm((f) => ({ ...f, voceId: e.target.value }))}
              >
                <option value="">{t('fields.voceNone')}</option>
                {voci.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t('fields.importo')}</span>
              <Input
                inputMode="decimal"
                placeholder={t('fields.importoPlaceholder')}
                value={form.importo}
                onChange={(e) => setForm((f) => ({ ...f, importo: e.target.value }))}
              />
              <span className="text-[11px] text-muted-foreground/80">
                {t('fields.importoHint')}
              </span>
            </label>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={form.fatturabile}
                onChange={(e) => setForm((f) => ({ ...f, fatturabile: e.target.checked }))}
              />
              <span>{t('fields.fatturabile')}</span>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
              <span>{t('fields.note')}</span>
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
              {saving ? t('saving') : editingId ? t('save') : t('add')}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : prestazioni.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('col.data')}</th>
                <th className="px-3 py-2">{t('col.descrizione')}</th>
                <th className="px-3 py-2">{t('col.voce')}</th>
                <th className="px-3 py-2 text-right">{t('col.ore')}</th>
                <th className="px-3 py-2">{t('col.fatturabile')}</th>
                <th className="px-3 py-2 text-right">{t('col.importo')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {prestazioni.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 text-muted-foreground">{p.data}</td>
                  <td className="px-3 py-2 font-medium">{p.descrizione}</td>
                  <td className="px-3 py-2 text-muted-foreground">{voceNome(p.voceId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.ore.toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.fatturabile ? t('yes') : t('no')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.importo === null ? '—' : `€ ${p.importo.toFixed(2)}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('edit')}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('delete')}
                          onClick={() => void remove(p)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  {t('totals')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{totali.ore.toFixed(2)}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">
                  {totali.importo > 0 ? `€ ${totali.importo.toFixed(2)}` : '—'}
                </td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
