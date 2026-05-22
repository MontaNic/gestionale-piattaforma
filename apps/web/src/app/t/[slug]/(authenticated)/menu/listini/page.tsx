'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import { PriceListForm } from '@/components/menu/PriceListForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { messageForError } from '@/lib/error-codes';
import { createPriceList, deletePriceList, listPriceLists, updatePriceList } from '@/lib/menu-api';
import type { CreatePriceListInput, PriceList } from '@/lib/menu-types';
import { cn } from '@/lib/utils';

// =============================================================================
// menu/listini/page.tsx — Lista + CRUD Listini prezzo (S20 ADR-0022)
// =============================================================================
// Route tenant-level: i listini NON sono per-singolo-menu. Segment statico
// `listini` → ha precedenza sul dinamico `[menuId]` fratello (Next App Router).
// Client component, pattern S19: stato React locale + refetch on mutation.
// Create + edit inline (PriceListForm), soft-delete con ConfirmDialog. Bottoni
// mutazione gated su `menu.prezzo.modifica`.
// =============================================================================

export default function PriceListsPage(): JSX.Element {
  const t = useTranslations('menu');
  const { tenant, permissions } = useAuth();
  const canModifyPrice = permissions.includes('menu.prezzo.modifica');

  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PriceList | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPriceLists(await listPriceLists());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(input: CreatePriceListInput): Promise<void> {
    await createPriceList(input);
    await load();
    setCreating(false);
  }

  async function handleUpdate(priceListId: string, input: CreatePriceListInput): Promise<void> {
    await updatePriceList(priceListId, input);
    await load();
    setEditingId(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deletePriceList(pendingDelete.id);
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

  /** Stringa di validità leggibile dalle date opzionali (`YYYY-MM-DD` o ISO). */
  function validityLabel(pl: PriceList): string {
    const from = pl.validFromDate?.slice(0, 10);
    const to = pl.validToDate?.slice(0, 10);
    if (from && to) return t('listini.validityRange', { from, to });
    if (from) return t('listini.validityFrom', { date: from });
    if (to) return t('listini.validityTo', { date: to });
    return t('listini.validityAlways');
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${tenant.slug}/menu`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('listini.backToMenu')}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listini.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('listini.subtitle')}</p>
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

      {canModifyPrice &&
        (creating ? (
          <Card>
            <CardContent className="pt-6">
              <PriceListForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('listini.new')}
          </Button>
        ))}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : priceLists.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listini.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {priceLists.map((pl) =>
            editingId === pl.id ? (
              <li key={pl.id}>
                <Card>
                  <CardContent className="pt-6">
                    <PriceListForm
                      priceList={pl}
                      onSubmit={(input) => handleUpdate(pl.id, input)}
                      onCancel={() => setEditingId(null)}
                    />
                  </CardContent>
                </Card>
              </li>
            ) : (
              <li key={pl.id}>
                <Card>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{pl.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {pl.channels.map((c) => t(`channels.${c}`)).join(' · ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('listini.priority', { value: pl.priority })}
                        {' · '}
                        {validityLabel(pl)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        pl.isActive
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {pl.isActive ? t('active') : t('inactive')}
                    </span>
                  </CardHeader>
                  {canModifyPrice && (
                    <CardContent className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingId(pl.id)}>
                        <Pencil className="h-4 w-4" />
                        {t('edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(pl)}
                        aria-label={t('delete')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardContent>
                  )}
                </Card>
              </li>
            ),
          )}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.priceListTitle')}
        description={pendingDelete ? t('confirm.priceListBody', { name: pendingDelete.name }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}
