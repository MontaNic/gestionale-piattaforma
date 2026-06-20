'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@gestionale/ui';

import { listReferenti } from '@/lib/referenti-api';
import type { Azienda } from '@/lib/aziende-types';
import type { Referente } from '@/lib/referenti-types';
import type { CreateComunicazioneInput } from '@/lib/comunicazioni-types';

// =============================================================================
// NuovaComunicazioneForm — apertura thread (oggetto + primo messaggio).
// =============================================================================
// Azienda obbligatoria; al cambio azienda carica i suoi referenti (select
// opzionale). Validazioni minime client-side (oggetto/testo non vuoti); i
// backstop reali sono nel service backend.
// =============================================================================

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Props {
  aziende: Azienda[];
  onSubmit: (input: CreateComunicazioneInput) => Promise<void>;
  onCancel: () => void;
}

export function NuovaComunicazioneForm({ aziende, onSubmit, onCancel }: Props): JSX.Element {
  const t = useTranslations('comunicazioni');
  const [aziendaId, setAziendaId] = useState('');
  const [referenteId, setReferenteId] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [testo, setTesto] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [referenti, setReferenti] = useState<Referente[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setReferenteId('');
    if (!aziendaId) {
      setReferenti([]);
      return;
    }
    let alive = true;
    void listReferenti(aziendaId)
      .then((r) => {
        if (alive) setReferenti(r);
      })
      .catch(() => {
        if (alive) setReferenti([]);
      });
    return () => {
      alive = false;
    };
  }, [aziendaId]);

  const canSubmit = useMemo(
    () => aziendaId !== '' && oggetto.trim() !== '' && testo.trim() !== '' && !submitting,
    [aziendaId, oggetto, testo, submitting],
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        aziendaId,
        referenteId: referenteId || undefined,
        oggetto: oggetto.trim(),
        testo: testo.trim(),
        urgente,
      });
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
            className={FIELD_CLASS}
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
          <span className="font-medium">{t('form.referente')}</span>
          <select
            className={FIELD_CLASS}
            value={referenteId}
            onChange={(e) => setReferenteId(e.target.value)}
            disabled={referenti.length === 0}
          >
            <option value="">{t('form.referentePlaceholder')}</option>
            {referenti.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('form.oggetto')}</span>
        <input
          className={FIELD_CLASS}
          value={oggetto}
          maxLength={255}
          onChange={(e) => setOggetto(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('form.testo')}</span>
        <textarea
          className={`${FIELD_CLASS} h-28 py-2`}
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
        <span>{t('form.urgente')}</span>
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {t('form.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
