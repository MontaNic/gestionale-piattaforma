'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@gestionale/ui';
import { Input } from '@gestionale/ui';
import { ApiError } from '@gestionale/api-client';
import { messageForError } from '@/lib/error-codes';
import type { Article } from '@/lib/menu-types';
import type { AddRigaInput } from '@/lib/conti-types';

// =============================================================================
// AddRigaForm.tsx — Aggiunta riga al conto (PR-1 comande, ADR-0068)
// =============================================================================
// Il FE manda solo articleId + quantità: il prezzo è risolto server-side
// (snapshot DP-C). L'articolo si sceglie da un catalogo (menu→categorie→articoli)
// passato dal parent.
//
// E_PRICE_AMBIGUOUS (409): NON un toast generico ma uno stato BLOCCANTE sul
// singolo articolo — l'opzione diventa non selezionabile (disabled) con un
// avviso dedicato, finché i listini non vengono corretti.
// =============================================================================

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const addRigaSchema = z.object({
  articleId: z.string().min(1, 'Seleziona un articolo'),
  quantita: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, 'La quantità deve essere un numero intero maggiore o uguale a 1'),
  // Nota cucina opzionale (max 200 char, coerente con AddRigaDto BE).
  note: z.string().trim().max(200, 'La nota non può superare 200 caratteri').optional(),
});

type AddRigaValues = z.infer<typeof addRigaSchema>;

export interface CatalogGroup {
  categoryId: string;
  categoryName: string;
  articles: Article[];
}

interface AddRigaFormProps {
  catalog: CatalogGroup[];
  /** Aggiunge la riga; deve lanciare (ApiError) in caso di errore backend. */
  onAdd: (input: AddRigaInput) => Promise<void>;
  onCancel: () => void;
}

export function AddRigaForm({ catalog, onAdd, onCancel }: AddRigaFormProps): JSX.Element {
  const t = useTranslations('comande');
  const [serverError, setServerError] = useState<string | null>(null);
  // Articoli con pricing ambiguo (E_PRICE_AMBIGUOUS): bloccati finché i listini
  // non vengono corretti. `ambiguousName` guida l'avviso dedicato.
  const [ambiguousIds, setAmbiguousIds] = useState<Set<string>>(new Set());
  const [ambiguousName, setAmbiguousName] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, Article>();
    for (const group of catalog) {
      for (const article of group.articles) map.set(article.id, article);
    }
    return map;
  }, [catalog]);

  const form = useForm<AddRigaValues>({
    resolver: zodResolver(addRigaSchema),
    defaultValues: { articleId: '', quantita: '1', note: '' },
  });

  const hasArticles = byId.size > 0;

  async function handleSubmit(values: AddRigaValues): Promise<void> {
    setServerError(null);
    if (ambiguousIds.has(values.articleId)) return; // opzione già bloccata
    const note = values.note?.trim();
    try {
      await onAdd({
        articleId: values.articleId,
        quantita: Number(values.quantita),
        // Omessa se vuota: il BE distingue "nessuna nota" (null) da nota valorizzata.
        note: note ? note : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.errorCode === 'E_PRICE_AMBIGUOUS') {
        const name = byId.get(values.articleId)?.name ?? values.articleId;
        setAmbiguousIds((prev) => new Set(prev).add(values.articleId));
        setAmbiguousName(name);
        form.setValue('articleId', '');
        return;
      }
      setServerError(messageForError(err));
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <p className="text-sm font-medium">{t('addRiga.title')}</p>

        {!hasArticles ? (
          <p className="text-sm text-muted-foreground">{t('addRiga.noArticles')}</p>
        ) : (
          <>
            <FormField
              control={form.control}
              name="articleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('addRiga.articleLabel')}</FormLabel>
                  <FormControl>
                    <select className={SELECT_CLASS} {...field}>
                      <option value="">{t('addRiga.articlePlaceholder')}</option>
                      {catalog.map((group) => (
                        <optgroup key={group.categoryId} label={group.categoryName}>
                          {group.articles.map((article) => {
                            const isAmbiguous = ambiguousIds.has(article.id);
                            return (
                              <option key={article.id} value={article.id} disabled={isAmbiguous}>
                                {isAmbiguous
                                  ? t('addRiga.ambiguousOption', { name: article.name })
                                  : article.name}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantita"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('addRiga.quantitaLabel')}</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('addRiga.noteLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      maxLength={200}
                      placeholder={t('addRiga.notePlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {ambiguousName && (
          <Alert variant="destructive">
            <AlertDescription>
              {t('addRiga.ambiguousNotice', { name: ambiguousName })}
            </AlertDescription>
          </Alert>
        )}
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!hasArticles || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('addRiga.adding') : t('addRiga.add')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            {t('addRiga.cancel')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
