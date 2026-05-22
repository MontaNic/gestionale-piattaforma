'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Pencil, Plus } from 'lucide-react';

import { CategoryForm } from '@/components/menu/CategoryForm';
import { CategorySection } from '@/components/menu/CategorySection';
import { MenuForm } from '@/components/menu/MenuForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api';
import { messageForError } from '@/lib/error-codes';
import {
  createCategory,
  getMenu,
  listArticlesByCategory,
  listCategories,
  listPriceLists,
  updateMenu,
} from '@/lib/menu-api';
import type {
  Article,
  CreateCategoryInput,
  CreateMenuInput,
  Menu,
  MenuCategory,
  PriceList,
} from '@/lib/menu-types';
import { cn } from '@/lib/utils';

// =============================================================================
// menu/[menuId]/page.tsx — Detail Menu (S19 FASE 5)
// =============================================================================
// Primo segment dinamico `[id]` del progetto. Edit Menu + CRUD Categorie inline
// + CRUD Articoli per categoria (via CategorySection). `load()` ri-fetcha menu
// + categorie + articoli ed e' passato come `onReload` a ogni CategorySection.
// Menu cancellato (soft-delete) → getMenu 404 → stato notFound.
// =============================================================================

export default function MenuDetailPage(): JSX.Element {
  const t = useTranslations('menu');
  const { tenant, permissions } = useAuth();
  const params = useParams<{ menuId: string }>();
  const menuId = params.menuId;

  const canManageMenu = permissions.includes('menu.categoria.gestisci');
  const canManageCategory = permissions.includes('menu.categoria.gestisci');
  const canCreateArticle = permissions.includes('menu.piatto.crea');
  const canModifyArticle = permissions.includes('menu.piatto.modifica');
  const canModifyPrice = permissions.includes('menu.prezzo.modifica');

  const [menu, setMenu] = useState<Menu | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [articlesByCat, setArticlesByCat] = useState<Record<string, Article[]>>({});
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editingMenu, setEditingMenu] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const fetchedMenu = await getMenu(menuId);
      const fetchedCategories = await listCategories(menuId);
      const entries = await Promise.all(
        fetchedCategories.map(
          async (cat) => [cat.id, await listArticlesByCategory(cat.id)] as const,
        ),
      );
      // Listini caricati una volta a livello menu-detail: solo gli attivi sono
      // rilevanti per la resolution display delle sezioni prezzi (ADR-0022 §1a).
      const fetchedPriceLists = await listPriceLists();
      setMenu(fetchedMenu);
      setCategories(fetchedCategories);
      setArticlesByCat(Object.fromEntries(entries));
      setPriceLists(fetchedPriceLists.filter((pl) => pl.isActive));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(messageForError(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, [menuId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpdateMenu(input: CreateMenuInput): Promise<void> {
    await updateMenu(menuId, input);
    await load();
    setEditingMenu(false);
  }

  async function handleCreateCategory(input: CreateCategoryInput): Promise<void> {
    await createCategory(menuId, input);
    await load();
    setCreatingCategory(false);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${tenant.slug}/menu`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      {isLoading && menu === null && (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      )}

      {notFound && (
        <Alert variant="destructive">
          <AlertDescription>{t('detailNotFound')}</AlertDescription>
        </Alert>
      )}

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

      {menu && (
        <>
          {/* ── Menu header / edit ──────────────────────────────────────── */}
          {editingMenu ? (
            <Card>
              <CardContent className="pt-6">
                <MenuForm
                  menu={menu}
                  onSubmit={handleUpdateMenu}
                  onCancel={() => setEditingMenu(false)}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">{menu.name}</h1>
                {menu.description && (
                  <p className="text-sm text-muted-foreground">{menu.description}</p>
                )}
                <span
                  className={cn(
                    'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                    menu.isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {menu.isActive ? t('active') : t('inactive')}
                </span>
              </div>
              {canManageMenu && (
                <Button variant="outline" size="sm" onClick={() => setEditingMenu(true)}>
                  <Pencil className="h-4 w-4" />
                  {t('editMenu')}
                </Button>
              )}
            </div>
          )}

          {/* ── Categorie ───────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('categoriesTitle')}</h2>

            {categories.length === 0 && !creatingCategory && (
              <p className="text-sm text-muted-foreground">{t('categoriesEmpty')}</p>
            )}

            {categories.map((category) => (
              <CategorySection
                key={category.id}
                menuId={menuId}
                category={category}
                articles={articlesByCat[category.id] ?? []}
                priceLists={priceLists}
                canManageCategory={canManageCategory}
                canCreateArticle={canCreateArticle}
                canModifyArticle={canModifyArticle}
                canModifyPrice={canModifyPrice}
                onReload={load}
              />
            ))}

            {creatingCategory ? (
              <CategoryForm
                onSubmit={handleCreateCategory}
                onCancel={() => setCreatingCategory(false)}
              />
            ) : (
              canManageCategory && (
                <Button variant="outline" size="sm" onClick={() => setCreatingCategory(true)}>
                  <Plus className="h-4 w-4" />
                  {t('newCategory')}
                </Button>
              )
            )}
          </section>
        </>
      )}
    </div>
  );
}
