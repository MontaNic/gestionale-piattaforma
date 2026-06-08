'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { AziendaForm } from '@/components/aziende/AziendaForm';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { Alert, AlertDescription, Button, Card, CardContent, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { messageForError } from '@/lib/error-codes';
import { createAzienda, deleteAzienda, listAziende, updateAzienda } from '@/lib/aziende-api';
import type { Azienda, AziendaFormPayload } from '@/lib/aziende-types';

// =============================================================================
// clienti/page.tsx — Anagrafica clienti (STOP-c2 ADR-0032)
// =============================================================================
// Route/label `clienti` invariate (DP-nav); la pagina consuma /api/v1/aziende.
// Client component: fetch via aziende-api, stato React locale, refetch on
// mutation (no react-query). Create/edit form inline in Card (DP-form, no
// segmento [id]). Soft-delete con ConfirmDialog → l'azienda sparisce dalla
// lista (backend filtra deletedAt IS NULL). Bottoni gated su permission
// anagrafica.cliente.{crea,modifica,elimina}.
// =============================================================================

export default function ClientiPage(): JSX.Element {
  const t = useTranslations('aziende');
  const { permissions } = useAuth();
  const canCreate = permissions.includes('anagrafica.cliente.crea');
  const canEdit = permissions.includes('anagrafica.cliente.modifica');
  const canDelete = permissions.includes('anagrafica.cliente.elimina');

  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Azienda | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Azienda | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setAziende(await listAziende());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(input: AziendaFormPayload): Promise<void> {
    await createAzienda(input);
    await load();
    setCreating(false);
  }

  async function handleUpdate(input: AziendaFormPayload): Promise<void> {
    if (!editing) return;
    await updateAzienda(editing.id, input);
    await load();
    setEditing(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAzienda(pendingDelete.id);
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
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canCreate && !creating && !editing && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newAzienda')}
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
            <AziendaForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}
      {editing && (
        <Card>
          <CardContent className="pt-6">
            <AziendaForm
              key={editing.id}
              azienda={editing}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : aziende.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('col.nome')}</th>
                <th className="px-3 py-2 font-medium">{t('col.codice')}</th>
                <th className="px-3 py-2 font-medium">{t('col.tipo')}</th>
                <th className="px-3 py-2 font-medium">{t('col.contatti')}</th>
                <th className="px-3 py-2 font-medium">{t('col.stato')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.azioni')}</th>
              </tr>
            </thead>
            <tbody>
              {aziende.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{a.nome}</td>
                  <td className="px-3 py-2">{a.codice}</td>
                  <td className="px-3 py-2">{t(`tipo.${a.tipoCliente}`)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a.email ?? a.telefono ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        a.attivo
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {a.attivo ? t('active') : t('inactive')}
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
                          setEditing(a);
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
                        onClick={() => setPendingDelete(a)}
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
    </div>
  );
}
