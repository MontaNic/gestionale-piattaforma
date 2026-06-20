'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';

import { Button } from '@gestionale/ui';

import type { Azienda } from '@/lib/aziende-types';
import type {
  DocumentoTipo,
  UploadDocumentoInput,
  VisibilitaDocumento,
} from '@/lib/documenti-types';
import { VISIBILITA_DOCUMENTO } from '@/lib/documenti-types';

// =============================================================================
// UploadDocumentoForm — upload documento (tipo + azienda + visibilità + file + note).
// =============================================================================
// File ≤ 20MB (validato anche dal backend). Al cambio tipo, pre-seleziona la
// visibilità di default del tipo. Validazioni minime client; backstop nel service.
// =============================================================================

const FIELD =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  aziende: Azienda[];
  tipi: DocumentoTipo[];
  onSubmit: (file: File, input: UploadDocumentoInput) => Promise<void>;
  onCancel: () => void;
}

export function UploadDocumentoForm({ aziende, tipi, onSubmit, onCancel }: Props): JSX.Element {
  const t = useTranslations('documenti');
  const [aziendaId, setAziendaId] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [visibilita, setVisibilita] = useState<VisibilitaDocumento>('tutti');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onTipoChange(value: string): void {
    setTipoId(value);
    const tipo = tipi.find((x) => x.id === value);
    if (tipo) setVisibilita(tipo.visibilitaDefault);
  }

  function pickFile(f: File | null): void {
    if (f && f.size > MAX_BYTES) {
      setLocalError(t('form.fileTooLarge'));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setLocalError(null);
    setFile(f);
  }

  const canSubmit = useMemo(
    () => aziendaId !== '' && tipoId !== '' && file !== null && !submitting,
    [aziendaId, tipoId, file, submitting],
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      await onSubmit(file, { tipoId, aziendaId, visibilita, note: note.trim() || undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.azienda')}</span>
          <select
            className={FIELD}
            value={aziendaId}
            onChange={(e) => setAziendaId(e.target.value)}
          >
            <option value="">{t('form.aziendaPlaceholder')}</option>
            {aziende.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.tipo')}</span>
          <select className={FIELD} value={tipoId} onChange={(e) => onTipoChange(e.target.value)}>
            <option value="">{t('form.tipoPlaceholder')}</option>
            {tipi.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.visibilita')}</span>
          <select
            className={FIELD}
            value={visibilita}
            onChange={(e) => setVisibilita(e.target.value as VisibilitaDocumento)}
          >
            {VISIBILITA_DOCUMENTO.map((v) => (
              <option key={v} value={v}>
                {t(`visibilita.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('form.file')}</span>
          <input
            ref={fileRef}
            type="file"
            className="text-sm"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('form.note')}</span>
        <textarea
          className={`${FIELD} h-20 py-2`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {localError && <p className="text-xs text-destructive">{localError}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          <Upload className="h-4 w-4" />
          {t('form.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
