'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { messageForError } from '@/lib/error-codes';
import {
  createArticle,
  deleteArticle,
  deleteCategory,
  updateArticle,
  updateCategory,
} from '@/lib/menu-api';
import type {
  Article,
  ArticleFormPayload,
  CreateCategoryInput,
  MenuCategory,
  PriceList,
} from '@/lib/menu-types';
import { ArticleForm } from './ArticleForm';
import { ArticlePricesSection } from './ArticlePricesSection';
import { CategoryForm } from './CategoryForm';
import { ConfirmDialog } from './ConfirmDialog';

// =============================================================================
// CategorySection.tsx — Una categoria + i suoi articoli, gestione inline (S19)
// =============================================================================
// CRUD categoria (edit/delete) + CRUD articoli per categoria (create/edit/
// delete). Lo stato dati vive nel parent (MenuDetailView) — `onReload` ri-fetcha
// dopo ogni mutation (no react-query, confine S19). Le mutation via form
// propagano gli errori al form (catch interno); il delete — senza form —
// mostra l'errore in un Alert locale.
// =============================================================================

type PendingDelete = { type: 'category' } | { type: 'article'; article: Article };

interface CategorySectionProps {
  menuId: string;
  category: MenuCategory;
  articles: Article[];
  /** Listini attivi — passati a ogni ArticlePricesSection per la resolution. */
  priceLists: PriceList[];
  canManageCategory: boolean;
  canCreateArticle: boolean;
  canModifyArticle: boolean;
  canModifyPrice: boolean;
  onReload: () => Promise<void>;
}

export function CategorySection({
  menuId,
  category,
  articles,
  priceLists,
  canManageCategory,
  canCreateArticle,
  canModifyArticle,
  canModifyPrice,
  onReload,
}: CategorySectionProps): JSX.Element {
  const t = useTranslations('menu');
  const [editingCategory, setEditingCategory] = useState(false);
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  // Articolo con la sezione "Prezzi per listino" aperta (toggle, uno per volta).
  const [pricesArticleId, setPricesArticleId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleUpdateCategory(input: CreateCategoryInput): Promise<void> {
    await updateCategory(menuId, category.id, input);
    await onReload();
    setEditingCategory(false);
  }

  async function handleCreateArticle(payload: ArticleFormPayload): Promise<void> {
    await createArticle({ ...payload, categoryId: category.id });
    await onReload();
    setCreatingArticle(false);
  }

  async function handleUpdateArticle(
    articleId: string,
    payload: ArticleFormPayload,
  ): Promise<void> {
    await updateArticle(articleId, payload);
    await onReload();
    setEditingArticleId(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      if (pendingDelete.type === 'category') {
        await deleteCategory(menuId, category.id);
      } else {
        await deleteArticle(pendingDelete.article.id);
      }
    } catch (err) {
      setDeleteError(messageForError(err));
      setPendingDelete(null);
      setIsDeleting(false);
      return;
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await onReload();
  }

  const confirmText =
    pendingDelete?.type === 'category'
      ? {
          title: t('confirm.categoryTitle'),
          description: t('confirm.categoryBody', { name: category.name }),
        }
      : pendingDelete?.type === 'article'
        ? {
            title: t('confirm.articleTitle'),
            description: t('confirm.articleBody', { name: pendingDelete.article.name }),
          }
        : { title: '', description: '' };

  return (
    <section className="rounded-lg border bg-card">
      {/* ── Header categoria ─────────────────────────────────────────────── */}
      {editingCategory ? (
        <div className="p-4">
          <CategoryForm
            category={category}
            onSubmit={handleUpdateCategory}
            onCancel={() => setEditingCategory(false)}
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="font-semibold">{category.name}</h3>
          {canManageCategory && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingCategory(true)}
                aria-label={t('edit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDelete({ type: 'category' })}
                aria-label={t('delete')}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 p-4">
        {deleteError && (
          <Alert variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}

        {/* ── Lista articoli ─────────────────────────────────────────────── */}
        {articles.length === 0 && !creatingArticle && (
          <p className="text-sm text-muted-foreground">{t('articlesEmpty')}</p>
        )}

        <ul className="space-y-2">
          {articles.map((article) =>
            editingArticleId === article.id ? (
              <li key={article.id}>
                <ArticleForm
                  article={article}
                  onSubmit={(payload) => handleUpdateArticle(article.id, payload)}
                  onCancel={() => setEditingArticleId(null)}
                />
              </li>
            ) : (
              <li key={article.id} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  {/* Display foto articolo differito con la pipeline upload (TD-BO):
                      S19 cattura solo photoUrl come input testuale nel form (branch A3). */}
                  <div>
                    <p className="font-medium">{article.name}</p>
                    <p className="text-sm text-muted-foreground">{article.descriptionShort}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">€ {article.basePrice}</span>
                      {' · '}
                      {t('meta.vat', { value: article.vatPercent })}
                      {' · '}
                      {t(`avail.${article.availability}`)}
                      {' · '}
                      {t(`dept.${article.printDepartment}`)}
                      {article.preparationTimeMinutes != null &&
                        ` · ${t('meta.prepTime', { value: article.preparationTimeMinutes })}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {/* "Prezzi" non gated: la sezione mostra la resolution in sola
                        lettura; le mutazioni override restano gated internamente. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPricesArticleId((cur) => (cur === article.id ? null : article.id))
                      }
                    >
                      <Tag className="h-4 w-4" />
                      {pricesArticleId === article.id ? t('prices.hide') : t('prices.show')}
                    </Button>
                    {canModifyArticle && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingArticleId(article.id)}
                          aria-label={t('edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete({ type: 'article', article })}
                          aria-label={t('delete')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {pricesArticleId === article.id && (
                  <ArticlePricesSection
                    article={article}
                    priceLists={priceLists}
                    canModifyPrice={canModifyPrice}
                  />
                )}
              </li>
            ),
          )}
        </ul>

        {/* ── Create articolo ────────────────────────────────────────────── */}
        {creatingArticle ? (
          <ArticleForm onSubmit={handleCreateArticle} onCancel={() => setCreatingArticle(false)} />
        ) : (
          canCreateArticle && (
            <Button variant="outline" size="sm" onClick={() => setCreatingArticle(true)}>
              <Plus className="h-4 w-4" />
              {t('newArticle')}
            </Button>
          )
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={confirmText.title}
        description={confirmText.description}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </section>
  );
}
