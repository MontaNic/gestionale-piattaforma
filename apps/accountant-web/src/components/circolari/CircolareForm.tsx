'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
} from '@gestionale/ui';

import type { Azienda } from '@/lib/aziende-types';
import type { CircolareWithDestinatari, CreateCircolareInput } from '@/lib/circolari-types';

// =============================================================================
// CircolareForm.tsx — form inline crea/modifica bozza circolare (ADR-0045)
// =============================================================================
// Pattern controlled-state (come UploadDocumentoForm). Body HTML in textarea
// grezza (no rich editor nell'MVP, YAGNI). Destinatari MVP: "tutti i clienti"
// oppure selezione di aziende specifiche (tipo='azienda'). La validazione
// forte è lato backend; qui solo i required minimi.
// =============================================================================

interface CircolareFormProps {
  aziende: Azienda[];
  initial?: CircolareWithDestinatari;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: CreateCircolareInput) => void;
  onCancel: () => void;
}

type DestMode = 'tutti' | 'aziende';

export function CircolareForm({
  aziende,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: CircolareFormProps): JSX.Element {
  const t = useTranslations('circolari.form');

  const [titolo, setTitolo] = useState(initial?.titolo ?? '');
  const [oggettoEmail, setOggettoEmail] = useState(initial?.oggettoEmail ?? '');
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? '');
  const [priorita, setPriorita] = useState<number>(initial?.priorita ?? 0);
  const [scadeIl, setScadeIl] = useState<string>(
    initial?.scadeIl ? initial.scadeIl.slice(0, 10) : '',
  );
  const [richiedeConferma, setRichiedeConferma] = useState<boolean>(
    initial?.richiedeConferma ?? false,
  );

  const initialMode: DestMode =
    !initial || initial.destinatari.some((d) => d.tipo === 'tutti') ? 'tutti' : 'aziende';
  const [destMode, setDestMode] = useState<DestMode>(initialMode);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        (initial?.destinatari ?? [])
          .filter((d) => d.tipo === 'azienda' && d.aziendaId)
          .map((d) => d.aziendaId as string),
      ),
  );

  const [localError, setLocalError] = useState<string | null>(null);

  const aziendeSorted = useMemo(
    () => [...aziende].sort((a, b) => a.nome.localeCompare(b.nome)),
    [aziende],
  );

  function toggleAzienda(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setLocalError(null);
    if (!titolo.trim() || !oggettoEmail.trim() || !bodyHtml.trim()) {
      setLocalError(t('errorRequired'));
      return;
    }
    const destinatari =
      destMode === 'tutti'
        ? [{ tipo: 'tutti' as const }]
        : [...selected].map((aziendaId) => ({ tipo: 'azienda' as const, aziendaId }));
    if (destinatari.length === 0) {
      setLocalError(t('errorDestinatari'));
      return;
    }
    onSubmit({
      titolo: titolo.trim(),
      oggettoEmail: oggettoEmail.trim(),
      bodyHtml,
      priorita,
      scadeIl: scadeIl || undefined,
      richiedeConferma,
      destinatari,
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {(localError ?? error) && (
            <Alert variant="destructive">
              <AlertDescription>{localError ?? error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="circ-titolo">{t('titolo')}</Label>
            <Input
              id="circ-titolo"
              value={titolo}
              maxLength={200}
              onChange={(e) => setTitolo(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="circ-oggetto">{t('oggettoEmail')}</Label>
            <Input
              id="circ-oggetto"
              value={oggettoEmail}
              maxLength={200}
              onChange={(e) => setOggettoEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="circ-body">{t('bodyHtml')}</Label>
            <Textarea
              id="circ-body"
              value={bodyHtml}
              rows={8}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="circ-priorita">{t('priorita')}</Label>
              <Input
                id="circ-priorita"
                type="number"
                min={0}
                max={10}
                value={priorita}
                onChange={(e) => setPriorita(Number(e.target.value))}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="circ-scade">{t('scadeIl')}</Label>
              <Input
                id="circ-scade"
                type="date"
                value={scadeIl}
                onChange={(e) => setScadeIl(e.target.value)}
                className="w-44"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={richiedeConferma}
              onChange={(e) => setRichiedeConferma(e.target.checked)}
            />
            {t('richiedeConferma')}
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('destinatari')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="destMode"
                checked={destMode === 'tutti'}
                onChange={() => setDestMode('tutti')}
              />
              {t('destTutti')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="destMode"
                checked={destMode === 'aziende'}
                onChange={() => setDestMode('aziende')}
              />
              {t('destAziende')}
            </label>
            {destMode === 'aziende' && (
              <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
                {aziendeSorted.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('noAziende')}</p>
                )}
                {aziendeSorted.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleAzienda(a.id)}
                    />
                    {a.nome}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
