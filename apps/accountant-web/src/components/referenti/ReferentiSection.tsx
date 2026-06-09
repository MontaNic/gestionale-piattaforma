'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { ReferenteForm } from '@/components/referenti/ReferenteForm';
import { messageForError } from '@/lib/error-codes';
import {
  createReferente,
  deleteReferente,
  listReferenti,
  updateReferente,
} from '@/lib/referenti-api';
import type { Referente, ReferenteFormPayload } from '@/lib/referenti-types';

// =============================================================================
// ReferentiSection.tsx — Sezione referenti nella detail cliente (STOP-c3b ADR-0034)
// =============================================================================
// Embedded nella detail page clienti/[id]. Consuma /aziende/:aziendaId/referenti.
// Stato React locale + refetch on mutation (no react-query). Create/edit form
// inline in Card (pattern lista clienti). Soft-delete con ConfirmDialog (generico,
// riusato da aziende) → il referente sparisce dalla lista. Bottoni gated su
// permission anagrafica.cliente.{crea,modifica,elimina}.
// =============================================================================

interface ReferentiSectionProps {
  aziendaId: string;
}

export function ReferentiSection({ aziendaId }: ReferentiSectionProps): JSX.Element {
  const t = useTranslations('referenti');
  const { permissions } = useAuth();
  const canCreate = permissions.includes('anagrafica.cliente.crea');
  const canEdit = permissions.includes('anagrafica.cliente.modifica');
  const canDelete = permissions.includes('anagrafica.cliente.elimina');

  const [referenti, setReferenti] = useState<Referente[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Referente | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Referente | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setReferenti(await listReferenti(aziendaId));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [aziendaId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(input: ReferenteFormPayload): Promise<void> {
    await createReferente(aziendaId, input);
    await load();
    setCreating(false);
  }

  async function handleUpdate(input: ReferenteFormPayload): Promise<void> {
    if (!editing) return;
    await updateReferente(aziendaId, editing.id, input);
    await load();
    setEditing(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteReferente(aziendaId, pendingDelete.id);
    } catch (err) {
      setDeleteError(messageForError(err));
      setPendingDelete(null);
      setIsDeleting(false);
      return;
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await load();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('sectionTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('sectionSubtitle')}</p>
        </div>
        {canCreate && !creating && !editing && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newReferente')}
          </Button>
        )}
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {deleteError && (
        <Alert variant="destructive">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      {creating && (
        <Card>
          <CardContent className="pt-6">
            <ReferenteForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}
      {editing && (
        <Card>
          <CardContent className="pt-6">
            <ReferenteForm
              key={editing.id}
              referente={editing}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : referenti.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('col.nome')}</th>
                <th className="px-3 py-2 font-medium">{t('col.ruolo')}</th>
                <th className="px-3 py-2 font-medium">{t('col.contatti')}</th>
                <th className="px-3 py-2 font-medium">{t('col.stato')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.azioni')}</th>
              </tr>
            </thead>
            <tbody>
              {referenti.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{r.nome}</td>
                  <td className="px-3 py-2">{t(`ruolo.${r.ruolo}`)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.email ?? r.telefono ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        r.attivo
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {r.attivo ? t('active') : t('inactive')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('edit')}
                        onClick={() => {
                          setCreating(false);
                          setEditing(r);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('delete')}
                        onClick={() => setPendingDelete(r)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.title')}
        description={pendingDelete ? t('confirm.body', { name: pendingDelete.nome }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </section>
  );
}
