'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, Plus, Trash2 } from 'lucide-react';

import { Button, Input, Textarea } from '@gestionale/ui';
import { computeTotali, computeVoce } from '@/lib/preventivi-totali';
import { UNITA_MISURA, type UnitaMisura, type VoceInput } from '@/lib/preventivi-types';
import {
  getCatalogoCategorie,
  getCatalogoServizi,
  type ServizioCatalogo,
  type ServizioCategoria,
} from '@/lib/catalogo-api';

// =============================================================================
// VociEditor.tsx — Editor righe preventivo, totali live (STOP-e2 ADR-0037)
// =============================================================================
// Cuore della feature. Controlled: la lista righe vive nel parent
// (PreventivoForm), qui solo rendering + edit cella + add/remove. I campi
// numerici sono STRINGHE (Discovery S19: niente z.coerce.number) convertiti con
// toNum() per il calcolo live e con Number() al submit (nel parent). I totali
// (riga + riepilogo) usano lo STESSO mirror della formula server
// (preventivi-totali) → quello che si vede a schermo coincide col salvato.
// Validazione cella: leggera (normalize ',' → '.', NaN/negativi → trattati come
// 0 nel calcolo live mentre l'utente digita); il blocco submit reale è nel
// parent (qta/prezzo non parsabili). Range/precisione → backend.
// =============================================================================

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** Riga in editing: numerici come stringa, `key` solo per React (non inviata). */
export interface VoceRow {
  key: string;
  nome: string;
  descrizione: string;
  unitaMisura: UnitaMisura;
  quantita: string;
  prezzoUnitario: string;
  scontoPct: string;
  ivaAliquota: string;
  note: string;
  // Tracciabilità catalogo (ADR-0050): valorizzato se la voce è stata
  // pre-compilata da una voce di catalogo. Non blocca l'editing successivo.
  servizioId?: string;
}

let rowSeq = 0;

/** Riga vuota di default (IVA 22% come da schema). */
export function emptyRow(): VoceRow {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    nome: '',
    descrizione: '',
    unitaMisura: 'forfait',
    quantita: '1',
    prezzoUnitario: '0',
    scontoPct: '0',
    ivaAliquota: '22',
    note: '',
  };
}

/** Mappa una PreventivoVoce (response) → riga editabile (stringhe). */
export function rowFromVoce(v: {
  nome: string;
  descrizione: string | null;
  unitaMisura: UnitaMisura;
  quantita: number;
  prezzoUnitario: number;
  scontoPct: number;
  ivaAliquota: number;
  note: string | null;
  servizioId?: string | null;
}): VoceRow {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    nome: v.nome,
    descrizione: v.descrizione ?? '',
    unitaMisura: v.unitaMisura,
    quantita: String(v.quantita),
    prezzoUnitario: String(v.prezzoUnitario),
    scontoPct: String(v.scontoPct),
    ivaAliquota: String(v.ivaAliquota),
    note: v.note ?? '',
    servizioId: v.servizioId ?? undefined,
  };
}

/** Normalizza una stringa numerica per il calcolo live (NaN/vuoto → 0). */
export function toNum(s: string): number {
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** True se la stringa è un numero finito ≥ 0 (per il blocco submit). */
export function isValidAmount(s: string): boolean {
  const t = s.trim().replace(',', '.');
  if (t === '') return false;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
}

/** Converte una riga in VoceInput (number) per il payload. `ordine` = index. */
export function rowToVoceInput(r: VoceRow, index: number): VoceInput {
  return {
    nome: r.nome.trim(),
    descrizione: r.descrizione.trim() === '' ? undefined : r.descrizione.trim(),
    unitaMisura: r.unitaMisura,
    quantita: toNum(r.quantita),
    prezzoUnitario: toNum(r.prezzoUnitario),
    scontoPct: toNum(r.scontoPct),
    ivaAliquota: toNum(r.ivaAliquota),
    ordine: index,
    note: r.note.trim() === '' ? undefined : r.note.trim(),
    servizioId: r.servizioId,
  };
}

const eur = (n: number): string => n.toFixed(2);

interface VociEditorProps {
  rows: VoceRow[];
  onChange: (rows: VoceRow[]) => void;
  disabled?: boolean;
}

export function VociEditor({ rows, onChange, disabled = false }: VociEditorProps): JSX.Element {
  const t = useTranslations('preventivi');

  const totali = useMemo(
    () =>
      computeTotali(
        rows.map((r) => ({
          quantita: toNum(r.quantita),
          prezzoUnitario: toNum(r.prezzoUnitario),
          scontoPct: toNum(r.scontoPct),
          ivaAliquota: toNum(r.ivaAliquota),
        })),
      ),
    [rows],
  );

  function patchRow(index: number, patch: Partial<VoceRow>): void {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow(): void {
    onChange([...rows, emptyRow()]);
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  // ── Picker "Dal catalogo" (ADR-0050) ──────────────────────────────────────────
  // Pannello inline (no Dialog primitive in @gestionale/ui). Carica i servizi
  // attivi (platform + custom) al primo apertura. Click su un servizio →
  // pre-compila una nuova voce (snapshot: prezzo/iva/um copiati, editabili dopo)
  // tracciando servizioId.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogoLoaded, setCatalogoLoaded] = useState(false);
  const [catalogoErr, setCatalogoErr] = useState(false);
  const [servizi, setServizi] = useState<ServizioCatalogo[]>([]);
  const [categorie, setCategorie] = useState<ServizioCategoria[]>([]);
  const [catFilter, setCatFilter] = useState('');

  async function togglePicker(): Promise<void> {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next && !catalogoLoaded) {
      setCatalogoErr(false);
      try {
        const [svc, cat] = await Promise.all([
          getCatalogoServizi({ attivo: true }),
          getCatalogoCategorie(),
        ]);
        setServizi(svc);
        setCategorie(cat);
        setCatalogoLoaded(true);
      } catch {
        setCatalogoErr(true);
      }
    }
  }

  function addFromServizio(s: ServizioCatalogo): void {
    const base = emptyRow();
    onChange([
      ...rows,
      {
        ...base,
        nome: s.nome,
        unitaMisura: s.unitaMisura,
        prezzoUnitario: String(s.prezzoBase),
        ivaAliquota: String(s.ivaAliquota),
        servizioId: s.id,
      },
    ]);
  }

  const serviziFiltrati = catFilter ? servizi.filter((s) => s.categoriaId === catFilter) : servizi;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{t('voci.title')}</h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void togglePicker()}
            disabled={disabled}
          >
            <BookOpen className="h-4 w-4" />
            Dal catalogo
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
            <Plus className="h-4 w-4" />
            {t('voci.add')}
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Scegli un servizio dal catalogo</span>
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
          </div>

          {catalogoErr ? (
            <p className="text-sm text-destructive">Impossibile caricare il catalogo.</p>
          ) : !catalogoLoaded ? (
            <p className="text-sm text-muted-foreground">Caricamento catalogo…</p>
          ) : serviziFiltrati.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun servizio disponibile.</p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border bg-background">
              {serviziFiltrati.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => addFromServizio(s)}
                    disabled={disabled}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{s.codice}</span>
                    <span className="flex-1 font-medium">{s.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`um.${s.unitaMisura}`)}
                    </span>
                    <span className="font-medium">€ {eur(s.prezzoBase)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {t('voci.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const rigaTotale = computeVoce({
              quantita: toNum(r.quantita),
              prezzoUnitario: toNum(r.prezzoUnitario),
              scontoPct: toNum(r.scontoPct),
              ivaAliquota: toNum(r.ivaAliquota),
            });
            return (
              <li key={r.key} className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <Input
                      aria-label={t('voci.nome')}
                      placeholder={t('voci.nome')}
                      value={r.nome}
                      onChange={(e) => patchRow(i, { nome: e.target.value })}
                      disabled={disabled}
                    />
                    <Textarea
                      aria-label={t('voci.descrizione')}
                      placeholder={t('voci.descrizione')}
                      rows={1}
                      value={r.descrizione}
                      onChange={(e) => patchRow(i, { descrizione: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('voci.remove')}
                    onClick={() => removeRow(i)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('voci.unitaMisura')}</span>
                    <select
                      className={SELECT_CLASS}
                      value={r.unitaMisura}
                      onChange={(e) => patchRow(i, { unitaMisura: e.target.value as UnitaMisura })}
                      disabled={disabled}
                    >
                      {UNITA_MISURA.map((u) => (
                        <option key={u} value={u}>
                          {t(`um.${u}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('voci.quantita')}</span>
                    <Input
                      inputMode="decimal"
                      className="h-9"
                      value={r.quantita}
                      onChange={(e) => patchRow(i, { quantita: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('voci.prezzoUnitario')}</span>
                    <Input
                      inputMode="decimal"
                      className="h-9"
                      value={r.prezzoUnitario}
                      onChange={(e) => patchRow(i, { prezzoUnitario: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('voci.scontoPct')}</span>
                    <Input
                      inputMode="decimal"
                      className="h-9"
                      value={r.scontoPct}
                      onChange={(e) => patchRow(i, { scontoPct: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('voci.ivaAliquota')}</span>
                    <Input
                      inputMode="decimal"
                      className="h-9"
                      value={r.ivaAliquota}
                      onChange={(e) => patchRow(i, { ivaAliquota: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t('voci.rigaImponibile')}:{' '}
                    <span className="font-medium text-foreground">
                      € {eur(rigaTotale.totaleRiga)}
                    </span>
                  </span>
                  <span>
                    {t('voci.rigaIva')}:{' '}
                    <span className="font-medium text-foreground">€ {eur(rigaTotale.iva)}</span>
                  </span>
                </div>

                <Input
                  aria-label={t('voci.note')}
                  placeholder={t('voci.note')}
                  value={r.note}
                  onChange={(e) => patchRow(i, { note: e.target.value })}
                  disabled={disabled}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Riepilogo totali live (mirror formula server) */}
      <dl className="ml-auto w-full max-w-xs space-y-1 rounded-md border bg-card p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('totali.imponibile')}</dt>
          <dd className="font-medium">€ {eur(totali.totaleImponibile)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('totali.iva')}</dt>
          <dd className="font-medium">€ {eur(totali.totaleIva)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 text-base font-semibold">
          <dt>{t('totali.totale')}</dt>
          <dd>€ {eur(totali.totale)}</dd>
        </div>
      </dl>
    </div>
  );
}
