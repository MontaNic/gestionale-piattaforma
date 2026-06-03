'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/menu/ConfirmDialog';
import { MenuForm } from '@/components/menu/MenuForm';
import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gestionale/ui';
import { useAuth } from '@/contexts/AuthContext';
import { messageForError } from '@/lib/error-codes';
import { createMenu, deleteMenu, listMenus } from '@/lib/menu-api';
import type { CreateMenuInput, Menu } from '@/lib/menu-types';
import { cn } from '@gestionale/ui';

// =============================================================================
// menu/page.tsx — Lista Menu (S19 FASE 4, sostituisce il placeholder)
// =============================================================================
// Client component (pattern dashboard/login). Fetch client-side via menu-api,
// stato React locale, refetch on mutation (no react-query — confine S19).
// Create Menu inline (RHF) + soft-delete con dialog di conferma. Bottoni
// gated su permission `menu.categoria.gestisci` (branch A5).
// =============================================================================

export default function MenuListPage(): JSX.Element {
  const t = useTranslations('menu');
  const { tenant, permissions } = useAuth();
  const canManageMenu = permissions.includes('menu.categoria.gestisci');

  const [menus, setMenus] = useState<Menu[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Menu | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setMenus(await listMenus());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(input: CreateMenuInput): Promise<void> {
    await createMenu(input);
    await load();
    setCreating(false);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteMenu(pendingDelete.id);
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
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {/* Entry-point listini: nessuno slot in Sidebar (union tipata fissa) → link
            qui (S20 ADR-0022). Visibile a chiunque acceda al menu (sola lettura ok). */}
        <Button asChild variant="outline" size="sm">
          <Link href={`/t/${tenant.slug}/menu/listini`}>{t('listini.link')}</Link>
        </Button>
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

      {canManageMenu &&
        (creating ? (
          <Card>
            <CardContent className="pt-6">
              <MenuForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newMenu')}
          </Button>
        ))}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : menus.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <ul className="space-y-3">
          {menus.map((menu) => (
            <li key={menu.id}>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{menu.name}</CardTitle>
                    {menu.description && <CardDescription>{menu.description}</CardDescription>}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      menu.isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {menu.isActive ? t('active') : t('inactive')}
                  </span>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/t/${tenant.slug}/menu/${menu.id}`}>{t('open')}</Link>
                  </Button>
                  {canManageMenu && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(menu)}
                      aria-label={t('delete')}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.menuTitle')}
        description={pendingDelete ? t('confirm.menuBody', { name: pendingDelete.name }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}
