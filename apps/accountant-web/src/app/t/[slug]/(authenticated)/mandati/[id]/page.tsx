'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { Alert, AlertDescription, Button, Input } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { messageForError } from '@/lib/error-codes';
import { PrestazioniSection } from '@/components/mandati/PrestazioniSection';
import {
  deleteMandato,
  getMandato,
  updateMandato,
  STATI_MANDATO,
  type Mandato,
  type StatoMandato,
} from '@/lib/mandati-api';

// =============================================================================
// mandati/[id]/page.tsx — Dettaglio + edit mandato (ADR-0051)
// =============================================================================
// Mostra testata (codice/importo snapshot, read-only) + form editabile
// (stato/date/note). canManage = mandati.gestisci. Soft-delete.
// =============================================================================

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function MandatoDetailPage(): JSX.Element {
  const t = useTranslations('mandati');
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const { permissions } = useAuth();
  const canManage = permissions.includes('mandati.gestisci');

  const [mandato, setMandato] = useState<Mandato | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Campi editabili
  const [stato, setStato] = useState<StatoMandato>('in_corso');
  const [inizio, setInizio] = useState('');
  const [finePrevista, setFinePrevista] = useState('');
  const [fineEffettiva, setFineEffettiva] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const m = await getMandato(id);
      setMandato(m);
      setStato(m.stato);
      setInizio(m.inizio ?? '');
      setFinePrevista(m.finePrevista ?? '');
      setFineEffettiva(m.fineEffettiva ?? '');
      setNote(m.note ?? '');
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setActionError(null);
    try {
      await updateMandato(id, {
        stato,
        inizio: inizio || undefined,
        finePrevista: finePrevista || undefined,
        fineEffettiva: fineEffettiva || undefined,
        note: note || undefined,
      });
      await load();
    } catch (err) {
      setActionError(messageForError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setActionError(null);
    try {
      await deleteMandato(id);
      router.push(`/t/${slug}/mandati`);
    } catch (err) {
      setActionError(messageForError(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Link
        href={`/t/${slug}/mandati`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : loadError || !mandato ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError ?? t('notFound')}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">{mandato.codice}</h1>
            <p className="text-sm text-muted-foreground">
              {t('detail.importoConcordato')}{' '}
              <span className="font-medium text-foreground">
                € {mandato.importoConcordato.toFixed(2)}
              </span>{' '}
              · {t('detail.snapshot')}
            </p>
          </header>

          {actionError && (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 rounded-md border p-4">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t('fields.stato')}</span>
              <select
                className={SELECT_CLASS}
                value={stato}
                onChange={(e) => setStato(e.target.value as StatoMandato)}
                disabled={!canManage}
              >
                {STATI_MANDATO.map((s) => (
                  <option key={s} value={s}>
                    {t(`stato.${s}`)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>{t('fields.inizio')}</span>
                <Input
                  type="date"
                  value={inizio}
                  onChange={(e) => setInizio(e.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>{t('fields.finePrevista')}</span>
                <Input
                  type="date"
                  value={finePrevista}
                  onChange={(e) => setFinePrevista(e.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>{t('fields.fineEffettiva')}</span>
                <Input
                  type="date"
                  value={fineEffettiva}
                  onChange={(e) => setFineEffettiva(e.target.value)}
                  disabled={!canManage}
                />
              </label>
            </div>

            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t('fields.note')}</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} disabled={!canManage} />
            </label>

            {canManage && (
              <div className="flex items-center justify-between gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => void handleDelete()}
                >
                  {t('delete')}
                </Button>
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            )}
          </div>

          {/* Timesheet (ADR-0053) — prestazioni sul mandato */}
          <PrestazioniSection mandatoId={mandato.id} mandatoStato={mandato.stato} />
        </>
      )}
    </div>
  );
}
