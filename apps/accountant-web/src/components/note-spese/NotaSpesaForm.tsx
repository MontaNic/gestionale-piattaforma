'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Send, Trash2, Upload } from 'lucide-react';

import { Alert, AlertDescription, Button } from '@gestionale/ui';

import type { Azienda } from '@/lib/aziende-types';
import type { Mandato } from '@/lib/mandati-api';
import { messageForError } from '@/lib/error-codes';
import { compressImageIfNeeded } from '@/lib/note-spese-image';
import type {
  CreateNotaSpesaInput,
  NotaSpesaDetail,
  TipoAllegatoNotaSpesa,
  TipoSpesa,
} from '@/lib/note-spese-types';
import {
  ALIQUOTE_IVA,
  DEDUCIBILITA,
  METODI_PAGAMENTO,
  TIPI_SPESA,
  allegatiMancanti,
  distanzaKmFuoriContesto,
  isEditabile,
  richiedeGiustificativo,
  richiedeScontrino,
} from '@/lib/note-spese-types';

// =============================================================================
// NotaSpesaForm — creazione/modifica nota spese + allegati (§3/§8)
// =============================================================================
// Editabile solo su stato ∈ {bozza, respinta}: su inviata/approvata il form è in
// SOLA LETTURA (il BE rifiuterebbe comunque, ma la UI non propone azioni
// impossibili). Su nota respinta il `motivoRifiuto` è mostrato in evidenza.
//
// D6 (§4.7) prevenuto A MONTE: scegliendo un mandato l'azienda viene forzata a
// quella del mandato, e cambiando azienda un mandato incoerente viene azzerato —
// la combinazione invalida non è componibile. Se arrivasse comunque, l'errore
// E_NOTASPESA_MANDATO_AZIENDA_MISMATCH ha un messaggio dedicato (error-codes).
//
// Gli allegati richiedono una nota già salvata (servono l'id): in creazione la
// sezione compare dopo il primo salvataggio.
// =============================================================================

const FIELD =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Props {
  nota: NotaSpesaDetail | null;
  dataIniziale: string; // YYYY-MM-DD (DP-2: giorno selezionato, o oggi)
  aziende: Azienda[];
  mandati: Mandato[];
  onSave: (input: CreateNotaSpesaInput) => Promise<void>;
  onUploadAllegato: (tipo: TipoAllegatoNotaSpesa, file: File) => Promise<void>;
  onDeleteAllegato: (allegatoId: string) => Promise<void>;
  onDownloadAllegato: (allegatoId: string, nomeOriginale: string) => void;
  onInvia: () => Promise<void>;
  onDelete: () => void;
  onCancel: () => void;
}

export function NotaSpesaForm({
  nota,
  dataIniziale,
  aziende,
  mandati,
  onSave,
  onUploadAllegato,
  onDeleteAllegato,
  onDownloadAllegato,
  onInvia,
  onDelete,
  onCancel,
}: Props): JSX.Element {
  const t = useTranslations('noteSpese');
  const readOnly = nota !== null && !isEditabile(nota);

  const [data, setData] = useState(nota?.data ?? dataIniziale);
  const [tipoSpesa, setTipoSpesa] = useState<TipoSpesa>(nota?.tipoSpesa ?? 'vitto');
  const [metodoPagamento, setMetodoPagamento] = useState(nota?.metodoPagamento ?? 'contanti');
  const [totale, setTotale] = useState(nota ? String(nota.totale) : '');
  const [aliquotaIva, setAliquotaIva] = useState(nota?.aliquotaIva ?? 'iva_22');
  const [deducibilitaFiscale, setDeducibilita] = useState(nota?.deducibilitaFiscale ?? 'd_100');
  const [fatturataASocieta, setFatturata] = useState(nota?.fatturataASocieta ?? false);
  const [distanzaKm, setDistanzaKm] = useState(
    nota?.distanzaKm != null ? String(nota.distanzaKm) : '',
  );
  const [scopoMissione, setScopo] = useState(nota?.scopoMissione ?? '');
  const [note, setNote] = useState(nota?.note ?? '');
  const [aziendaId, setAziendaId] = useState(nota?.aziendaId ?? '');
  const [mandatoId, setMandatoId] = useState(nota?.mandatoId ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [busyTipo, setBusyTipo] = useState<TipoAllegatoNotaSpesa | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const totaleNum = Number(totale.replace(',', '.'));
  const distanzaNum = distanzaKm.trim() === '' ? null : Number(distanzaKm.replace(',', '.'));

  // D6 a monte: i mandati proponibili sono solo quelli dell'azienda scelta.
  const mandatiSelezionabili = useMemo(
    () => (aziendaId ? mandati.filter((m) => m.aziendaId === aziendaId) : mandati),
    [mandati, aziendaId],
  );

  function onMandatoChange(value: string): void {
    setMandatoId(value);
    // Scegliendo un mandato l'azienda è determinata: la forziamo (D6).
    const m = mandati.find((x) => x.id === value);
    if (m) setAziendaId(m.aziendaId);
  }

  function onAziendaChange(value: string): void {
    setAziendaId(value);
    // Un mandato di un'altra azienda diventerebbe incoerente → azzerato.
    if (mandatoId) {
      const m = mandati.find((x) => x.id === mandatoId);
      if (m && m.aziendaId !== value) setMandatoId('');
    }
  }

  // Warning NON bloccanti (§8/§4.6).
  const kmFuoriContesto =
    distanzaNum !== null &&
    distanzaNum > 0 &&
    distanzaKmFuoriContesto({ distanzaKm: distanzaNum, tipoSpesa });
  const mancanti = nota
    ? allegatiMancanti({
        totale: nota.totale,
        metodoPagamento: nota.metodoPagamento,
        allegati: nota.allegati,
      })
    : [];
  // Anticipo del gating anche in bozza non ancora salvata (dai valori del form).
  const serveGiustificativo = richiedeGiustificativo({
    totale: Number.isFinite(totaleNum) ? totaleNum : 0,
  });
  const serveScontrino = richiedeScontrino({ metodoPagamento });

  const canSubmit =
    data !== '' &&
    scopoMissione.trim() !== '' &&
    Number.isFinite(totaleNum) &&
    totaleNum >= 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await onSave({
        data,
        tipoSpesa,
        metodoPagamento,
        totale: totaleNum,
        aliquotaIva,
        deducibilitaFiscale,
        scopoMissione: scopoMissione.trim(),
        aziendaId: aziendaId || null,
        mandatoId: mandatoId || null,
        fatturataASocieta,
        distanzaKm: distanzaNum,
        note: note.trim() || null,
      });
    } catch (err) {
      setFormError(messageForError(err));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * L'invio è l'operazione che il BE può rifiutare per i gating §4.1/§4.2: la
   * rejection DEVE diventare messaggio a schermo, non una promise non gestita
   * (altrimenti l'utente non vede perché la nota non parte).
   */
  async function handleInvia(): Promise<void> {
    setSubmitting(true);
    setFormError(null);
    try {
      await onInvia();
    } catch (err) {
      setFormError(messageForError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAllegato(allegatoId: string): Promise<void> {
    setFormError(null);
    try {
      await onDeleteAllegato(allegatoId);
    } catch (err) {
      setFormError(messageForError(err));
    }
  }

  async function pickAllegato(tipo: TipoAllegatoNotaSpesa, file: File | null): Promise<void> {
    if (!file) return;
    setBusyTipo(tipo);
    setFormError(null);
    try {
      // Compressione client-side: solo immagini, mai PDF; fallback sull'originale.
      const finale = await compressImageIfNeeded(file);
      await onUploadAllegato(tipo, finale);
    } catch (err) {
      setFormError(messageForError(err));
    } finally {
      setBusyTipo(null);
    }
  }

  function renderAllegato(tipo: TipoAllegatoNotaSpesa): JSX.Element {
    const esistente = nota?.allegati.find((a) => a.tipo === tipo);
    const richiesto = tipo === 'giustificativo' ? serveGiustificativo : serveScontrino;
    return (
      <div key={tipo} className="space-y-1 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t(`tipoAllegato.${tipo}`)}</span>
          {richiesto && !esistente && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
              {t('allegatoRichiesto')}
            </span>
          )}
        </div>
        {/* Hint di validità INLINE (§8), non tooltip. */}
        <p className="text-xs text-muted-foreground">{t(`hintAllegato.${tipo}`)}</p>

        {esistente ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="text-sm underline underline-offset-2"
              onClick={() => onDownloadAllegato(esistente.id, esistente.nomeOriginale)}
            >
              {esistente.nomeOriginale}
            </button>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('rimuoviAllegato')}
                disabled={busyTipo === tipo}
                onClick={() => void handleDeleteAllegato(esistente.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ) : readOnly ? (
          <p className="pt-1 text-xs text-muted-foreground">{t('nessunAllegato')}</p>
        ) : (
          <input
            type="file"
            className="pt-1 text-sm"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={busyTipo === tipo}
            onChange={(e) => void pickAllegato(tipo, e.target.files?.[0] ?? null)}
          />
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      {nota?.stato === 'respinta' && nota.motivoRifiuto && (
        <Alert variant="destructive">
          <AlertDescription>
            <strong>{t('motivoRifiuto')}</strong> {nota.motivoRifiuto}
          </AlertDescription>
        </Alert>
      )}

      {readOnly && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {t('solaLettura', { stato: t(`stato.${nota.stato}`) })}
        </p>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.data')}</span>
          <input
            type="date"
            className={FIELD}
            value={data}
            disabled={readOnly}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.tipoSpesa')}</span>
          <select
            className={FIELD}
            value={tipoSpesa}
            disabled={readOnly}
            onChange={(e) => setTipoSpesa(e.target.value as TipoSpesa)}
          >
            {TIPI_SPESA.map((v) => (
              <option key={v} value={v}>
                {t(`tipoSpesa.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.totale')}</span>
          <input
            type="text"
            inputMode="decimal"
            className={FIELD}
            value={totale}
            disabled={readOnly}
            onChange={(e) => setTotale(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.metodoPagamento')}</span>
          <select
            className={FIELD}
            value={metodoPagamento}
            disabled={readOnly}
            onChange={(e) => setMetodoPagamento(e.target.value as typeof metodoPagamento)}
          >
            {METODI_PAGAMENTO.map((v) => (
              <option key={v} value={v}>
                {t(`metodoPagamento.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.aliquotaIva')}</span>
          <select
            className={FIELD}
            value={aliquotaIva}
            disabled={readOnly}
            onChange={(e) => setAliquotaIva(e.target.value as typeof aliquotaIva)}
          >
            {ALIQUOTE_IVA.map((v) => (
              <option key={v} value={v}>
                {t(`aliquotaIva.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.deducibilita')}</span>
          <select
            className={FIELD}
            value={deducibilitaFiscale}
            disabled={readOnly}
            onChange={(e) => setDeducibilita(e.target.value as typeof deducibilitaFiscale)}
          >
            {DEDUCIBILITA.map((v) => (
              <option key={v} value={v}>
                {t(`deducibilita.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.azienda')}</span>
          <select
            className={FIELD}
            value={aziendaId}
            disabled={readOnly}
            onChange={(e) => onAziendaChange(e.target.value)}
          >
            <option value="">{t('form.aziendaNessuna')}</option>
            {aziende.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.mandato')}</span>
          <select
            className={FIELD}
            value={mandatoId}
            disabled={readOnly}
            onChange={(e) => onMandatoChange(e.target.value)}
          >
            <option value="">{t('form.mandatoNessuno')}</option>
            {mandatiSelezionabili.map((m) => (
              <option key={m.id} value={m.id}>
                {m.codice}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.distanzaKm')}</span>
          <input
            type="text"
            inputMode="decimal"
            className={FIELD}
            value={distanzaKm}
            disabled={readOnly}
            onChange={(e) => setDistanzaKm(e.target.value)}
          />
          {/* Soft-warning §4.6/D4: nessun blocco, il BE non valida. */}
          {kmFuoriContesto && (
            <span className="text-xs text-amber-700 dark:text-amber-400">{t('warnKm')}</span>
          )}
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={fatturataASocieta}
            disabled={readOnly}
            onChange={(e) => setFatturata(e.target.checked)}
          />
          <span className="font-medium">{t('form.fatturataASocieta')}</span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('form.scopoMissione')}</span>
        <input
          type="text"
          className={FIELD}
          value={scopoMissione}
          disabled={readOnly}
          maxLength={500}
          onChange={(e) => setScopo(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('form.note')}</span>
        <textarea
          className={`${FIELD} h-20 py-2`}
          value={note}
          disabled={readOnly}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {/* Allegati: upload SEPARATI per tipo (§8), max 1 per tipo (@@unique DB). */}
      {nota ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {renderAllegato('giustificativo')}
          {renderAllegato('scontrino_pos')}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('allegatiDopoSalvataggio')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <Button type="submit" disabled={!canSubmit}>
            {nota ? t('form.salvaModifiche') : t('form.salva')}
          </Button>
        )}
        {nota && !readOnly && (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void handleInvia()}
            title={mancanti.length > 0 ? t('inviaBloccatoHint') : undefined}
          >
            <Send className="h-4 w-4" />
            {t('form.invia')}
          </Button>
        )}
        {nota?.stato === 'bozza' && !readOnly && (
          <Button type="button" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
            {t('form.elimina')}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.chiudi')}
        </Button>
        {busyTipo && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5" />
            {t('caricamento')}
          </span>
        )}
      </div>
    </form>
  );
}
