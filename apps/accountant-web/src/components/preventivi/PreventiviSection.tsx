'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { messageForError } from '@/lib/error-codes';
import { deletePreventivo, listPreventivi } from '@/lib/preventivi-api';
import type { Preventivo, StatoPreventivo } from '@/lib/preventivi-types';

// =============================================================================
// PreventiviSection.tsx — Lista preventivi nella detail cliente (STOP-e2 ADR-0037)
// =============================================================================
// Embedded sotto clienti/[id] (pattern ReferentiSection). A differenza dei
// referenti, l'editor NON è inline: la create/edit avviene su route dedicata
// (.../preventivi/nuovo, .../preventivi/[id]) per ospitare l'editor voci. Qui
// solo lista read-only + navigazione + soft-delete con ConfirmDialog. Stato
// React locale + refetch on mutation (no react-query). Gating: la lista richiede
// preventivi.visualizza; i bottoni CRUD preventivi.gestisci.
// =============================================================================

const STATO_BADGE: Record<StatoPreventivo, string> = {
  bozza: 'bg-muted text-muted-foreground',
  inviato: 'bg-secondary text-secondary-foreground',
  accettato: 'bg-secondary text-secondary-foreground',
  rifiutato: 'bg-muted text-muted-foreground',
};

interface PreventiviSectionProps {
  aziendaId: string;
}

export function PreventiviSection({ aziendaId }: PreventiviSectionProps): JSX.Element | null {
  const t = useTranslations('preventivi');
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const { permissions } = useAuth();
  const canView = permissions.includes('preventivi.visualizza');
  const canManage = permissions.includes('preventivi.gestisci');

  const [preventivi, setPreventivi] = useState<Preventivo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Preventivo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPreventivi(await listPreventivi(aziendaId));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [aziendaId]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  // Senza permesso di lettura la sezione non si mostra (la GET sarebbe 403).
  if (!canView) return null;

  const basePath = `/t/${slug}/clienti/${aziendaId}/preventivi`;

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deletePreventivo(aziendaId, pendingDelete.id);
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
        {canManage && (
          <Button size="sm" onClick={() => router.push(`${basePath}/nuovo`)}>
            <Plus className="h-4 w-4" />
            {t('newPreventivo')}
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : preventivi.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('col.codice')}</th>
                <th className="px-3 py-2 font-medium">{t('col.oggetto')}</th>
                <th className="px-3 py-2 font-medium">{t('col.stato')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.totale')}</th>
                <th className="px-3 py-2 font-medium">{t('col.validoFino')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.azioni')}</th>
              </tr>
            </thead>
            <tbody>
              {preventivi.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => router.push(`${basePath}/${p.id}`)}
                >
                  <td className="px-3 py-2 font-medium">{p.codice}</td>
                  <td className="px-3 py-2">{p.oggetto}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        STATO_BADGE[p.stato],
                      )}
                    >
                      {t(`stato.${p.stato}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">€ {p.totale.toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.validoFino ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('edit')}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`${basePath}/${p.id}`);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(p);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
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
        description={pendingDelete ? t('confirm.body', { codice: pendingDelete.codice }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </section>
  );
}
