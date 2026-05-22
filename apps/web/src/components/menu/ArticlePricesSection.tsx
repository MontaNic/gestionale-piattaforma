'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pencil, Plus, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { messageForError } from '@/lib/error-codes';
import {
  deleteArticlePrice,
  listArticlePrices,
  setArticlePrice,
  updateArticlePrice,
} from '@/lib/menu-api';
import type { Article, ArticlePrice, PriceList } from '@/lib/menu-types';

// =============================================================================
// ArticlePricesSection.tsx — Override prezzi per listino di un articolo (S20)
// =============================================================================
// Sezione on-demand (toggled da CategorySection): si monta quando l'utente apre
// "Prezzi" → fetch lazy degli ArticlePrice del solo articolo (evita N+1 eager
// su tutta la lista). Resolution display Opzione 1a (ADR-0022): per ogni listino
// attivo il prezzo applicato = `override?.price ?? article.basePrice`. L'assenza
// di override è uno stato valido = "usa prezzo base" — NON si crea mai un
// override ridondante sul listino base.
//
// La validazione formato (importo numerico) è client-side minimale; range e
// precisione (>2 decimali, negativi) restano al backend → l'errorCode emesso
// viene reso via `messageForError` (i18n), non come stringa grezza.
// =============================================================================

interface ArticlePricesSectionProps {
  article: Article;
  /** Listini su cui calcolare la resolution — già filtrati ai soli `isActive`. */
  priceLists: PriceList[];
  canModifyPrice: boolean;
}

export function ArticlePricesSection({
  article,
  priceLists,
  canModifyPrice,
}: ArticlePricesSectionProps): JSX.Element {
  const t = useTranslations('menu');
  const [prices, setPrices] = useState<ArticlePrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // Riga in editing = priceListId target; `draft` = importo digitato.
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPrices(await listArticlePrices(article.id));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [article.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const overrideByList = new Map<string, ArticlePrice>(
    prices.map((p) => [p.priceListId, p] as const),
  );

  function startEdit(priceListId: string, currentValue: string): void {
    setEditingListId(priceListId);
    setDraft(currentValue);
    setDraftError(null);
    setRowError(null);
  }

  function cancelEdit(): void {
    setEditingListId(null);
    setDraft('');
    setDraftError(null);
  }

  async function saveOverride(priceListId: string): Promise<void> {
    const normalized = draft.trim().replace(',', '.');
    // Guard solo formato: vuoto / non numerico. Range e precisione → backend.
    if (normalized === '' || Number.isNaN(Number(normalized))) {
      setDraftError(t('prices.invalidFormat'));
      return;
    }
    setIsSaving(true);
    setRowError(null);
    try {
      const existing = overrideByList.get(priceListId);
      if (existing) {
        await updateArticlePrice(article.id, existing.id, { price: Number(normalized) });
      } else {
        await setArticlePrice(article.id, { priceListId, price: Number(normalized) });
      }
      cancelEdit();
      await load();
    } catch (err) {
      setRowError(messageForError(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeOverride(override: ArticlePrice): Promise<void> {
    setIsSaving(true);
    setRowError(null);
    try {
      await deleteArticlePrice(article.id, override.id);
      await load();
    } catch (err) {
      setRowError(messageForError(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-sm font-medium">{t('prices.sectionTitle')}</p>

      {isLoading && <p className="text-sm text-muted-foreground">{t('prices.loading')}</p>}

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

      {rowError && (
        <Alert variant="destructive" className="mb-2">
          <AlertDescription>{rowError}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !loadError && priceLists.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('prices.noPriceLists')}</p>
      )}

      {!isLoading && !loadError && priceLists.length > 0 && (
        <ul className="space-y-1.5">
          {priceLists.map((pl) => {
            const override = overrideByList.get(pl.id);
            const appliedPrice = override?.price ?? article.basePrice;
            const isEditing = editingListId === pl.id;
            return (
              <li key={pl.id} className="rounded border bg-background px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{pl.name}</span>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        inputMode="decimal"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="0.00"
                        className="h-8 w-24"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => void saveOverride(pl.id)}
                        disabled={isSaving}
                        aria-label={t('save')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={cancelEdit}
                        disabled={isSaving}
                        aria-label={t('cancel')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">€ {appliedPrice}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {override ? t('prices.overrideLabel') : t('prices.baseLabel')}
                      </span>
                      {canModifyPrice &&
                        (override ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => startEdit(pl.id, override.price)}
                              aria-label={t('prices.editOverride')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => void removeOverride(override)}
                              disabled={isSaving}
                              aria-label={t('prices.removeOverride')}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => startEdit(pl.id, article.basePrice)}
                          >
                            <Plus className="h-4 w-4" />
                            {t('prices.setOverride')}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>
                {isEditing && draftError && (
                  <p className="mt-1 text-xs text-destructive">{draftError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
