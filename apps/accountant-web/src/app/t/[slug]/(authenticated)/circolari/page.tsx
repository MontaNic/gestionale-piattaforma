'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Archive, Megaphone, Pencil, Plus, Send, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { CircolareForm } from '@/components/circolari/CircolareForm';
import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import {
  archiveCircolare,
  createCircolare,
  deleteCircolare,
  getCircolare,
  getCircolari,
  publishCircolare,
  updateCircolare,
} from '@/lib/circolari-api';
import type {
  Circolare,
  CircolareStato,
  CircolareWithDestinatari,
  CreateCircolareInput,
} from '@/lib/circolari-types';

// =============================================================================
// circolari/page.tsx — Broadcast studio→clienti (ADR-0045, solo operatore)
// =============================================================================
// Client component (pattern documenti/comunicazioni). Lista + filtro stato.
// Form crea/modifica inline (gated circolari.create). Transizioni publish/
// archive gated sui rispettivi permessi. Delete solo su bozza.
// =============================================================================

const STATO_BADGE: Record<CircolareStato, string> = {
  bozza: 'bg-muted text-muted-foreground',
  pubblicata: 'bg-green-100 text-green-800',
  archiviata: 'bg-amber-100 text-amber-800',
};

export default function CircolariPage(): JSX.Element {
  const t = useTranslations('circolari');
  const locale = useLocale();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { permissions } = useAuth();
  const canCreate = permissions.includes('circolari.create');
  const canPublish = permissions.includes('circolari.publish');
  const canArchive = permissions.includes('circolari.archive');

  const [items, setItems] = useState<Circolare[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filterStato, setFilterStato] = useState<'' | CircolareStato>('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CircolareWithDestinatari | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Circolare | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const SELECT =
    'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(await getCircolari({ stato: filterStato || undefined }));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [filterStato]);

  useEffect(() => {
    void listAziende()
      .then(setAziende)
      .catch(() => {
        /* best-effort: il form destinatari-azienda resta vuoto */
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );
  const fmtDate = (s: string | null): string => (s ? dateFmt.format(new Date(s)) : '—');

  function openCreate(): void {
    setEditing(null);
    setFormError(null);
    setShowForm(true);
  }

  async function openEdit(c: Circolare): Promise<void> {
    setFormError(null);
    try {
      const full = await getCircolare(c.id);
      setEditing(full);
      setShowForm(true);
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  async function handleSubmit(input: CreateCircolareInput): Promise<void> {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing) {
        await updateCircolare(editing.id, input);
      } else {
        await createCircolare(input);
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(messageForError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(c: Circolare): Promise<void> {
    try {
      await publishCircolare(c.id);
      await load();
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  async function handleArchive(c: Circolare): Promise<void> {
    try {
      await archiveCircolare(c.id);
      await load();
    } catch (err) {
      setLoadError(messageForError(err));
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteCircolare(pendingDelete.id);
    } catch {
      /* delete raro; ricarico comunque */
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canCreate && !showForm && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('newCircolare')}
          </Button>
        )}
      </header>

      {showForm && (
        <CircolareForm
          aziende={aziende}
          initial={editing ?? undefined}
          submitting={submitting}
          error={formError}
          onSubmit={(input) => void handleSubmit(input)}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.stato')}
          <select
            className={SELECT}
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value as '' | CircolareStato)}
          >
            <option value="">{t('filters.all')}</option>
            <option value="bozza">{t('stato.bozza')}</option>
            <option value="pubblicata">{t('stato.pubblicata')}</option>
            <option value="archiviata">{t('stato.archiviata')}</option>
          </select>
        </label>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('table.titolo')}</th>
                  <th className="px-4 py-2 font-medium">{t('table.stato')}</th>
                  <th className="px-4 py-2 font-medium">{t('table.priorita')}</th>
                  <th className="px-4 py-2 font-medium">{t('table.pubblicataIl')}</th>
                  <th className="px-4 py-2 font-medium">{t('table.scadeIl')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('table.azioni')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/t/${slug}/circolari/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.titolo}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATO_BADGE[c.stato]}`}
                      >
                        {t(`stato.${c.stato}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2">{c.priorita}</td>
                    <td className="px-4 py-2">{fmtDate(c.pubblicataIl)}</td>
                    <td className="px-4 py-2">{fmtDate(c.scadeIl)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {canCreate && c.stato === 'bozza' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openEdit(c)}
                            title={t('actions.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canPublish && c.stato === 'bozza' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handlePublish(c)}
                            title={t('actions.publish')}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        {canArchive && c.stato === 'pubblicata' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleArchive(c)}
                            title={t('actions.archive')}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                        {canCreate && c.stato === 'bozza' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingDelete(c)}
                            title={t('actions.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.deleteTitle')}
        description={t('confirm.deleteDescription')}
        confirmLabel={t('actions.delete')}
        cancelLabel={t('form.cancel')}
        isPending={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
