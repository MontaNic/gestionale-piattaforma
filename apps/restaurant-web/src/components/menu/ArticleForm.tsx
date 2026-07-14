'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@gestionale/ui';
import { Input } from '@gestionale/ui';
import { Textarea } from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import {
  AVAILABILITIES,
  PORTATE,
  PRINT_DEPARTMENTS,
  VAT_RATES,
  type Article,
  type ArticleFormPayload,
} from '@/lib/menu-types';

// =============================================================================
// ArticleForm.tsx — Form create/edit Article (S19 ADR-0020)
// =============================================================================
// Campi gestiti S19 = sottoinsieme "CRUD base" di CreateArticleDto: name,
// descrizioni, photoUrl (branch A3 — input URL, no upload pipeline TD-BO),
// basePrice, vatPercent, printDepartment, availability, prepTime, sortOrder.
// FUORI scope S19 (multi-select enum → TD-CA): allergens, dietaryTags,
// channelVisibility — opzionali backend, omessi (default [] server-side).
// Prezzo: solo `basePrice` (ADR-0020 §prezzo — gli ArticlePrice/listini → S20).
// =============================================================================

// Select nativo (no @radix-ui/react-select — confine "nessuna nuova dipendenza"):
// classi allineate a input.tsx.
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const articleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Il nome deve avere almeno 2 caratteri')
    .max(120, 'Il nome non può superare 120 caratteri'),
  descriptionShort: z
    .string()
    .trim()
    .min(1, 'La descrizione breve è obbligatoria')
    .max(200, 'La descrizione breve non può superare 200 caratteri'),
  descriptionLong: z
    .string()
    .trim()
    .max(2000, 'La descrizione estesa non può superare 2000 caratteri'),
  photoUrl: z.string().trim().max(500, "L'URL della foto non può superare 500 caratteri"),
  basePrice: z
    .string()
    .trim()
    .min(1, 'Il prezzo è obbligatorio')
    .regex(/^\d+([.,]\d{1,2})?$/, 'Prezzo non valido (es. 12.50)'),
  vatPercent: z.enum(['4', '10', '22']),
  printDepartment: z.enum(['cucina', 'pizzeria', 'bar']),
  availability: z.enum(['in_carta', 'esaurito', 'sospeso']),
  portata: z.enum(['antipasto', 'primo', 'secondo', 'contorno', 'dolce', 'bevanda', 'nessuna']),
  preparationTimeMinutes: z.string().trim().regex(/^\d*$/, 'Inserire un numero intero di minuti'),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d+$/, "L'ordine deve essere un numero intero maggiore o uguale a zero"),
});

type ArticleFormValues = z.infer<typeof articleFormSchema>;

interface ArticleFormProps {
  /** Articolo esistente → modalità edit; assente → modalità create. */
  article?: Article;
  onSubmit: (payload: ArticleFormPayload) => Promise<void>;
  onCancel: () => void;
}

export function ArticleForm({ article, onSubmit, onCancel }: ArticleFormProps): JSX.Element {
  const t = useTranslations('menu');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ArticleFormValues>({
    resolver: zodResolver(articleFormSchema),
    defaultValues: {
      name: article?.name ?? '',
      descriptionShort: article?.descriptionShort ?? '',
      descriptionLong: article?.descriptionLong ?? '',
      photoUrl: article?.photoUrl ?? '',
      basePrice: article?.basePrice ?? '',
      vatPercent: (article ? String(article.vatPercent) : '10') as ArticleFormValues['vatPercent'],
      printDepartment: article?.printDepartment ?? 'cucina',
      availability: article?.availability ?? 'in_carta',
      portata: article?.portata ?? 'nessuna',
      preparationTimeMinutes:
        article?.preparationTimeMinutes != null ? String(article.preparationTimeMinutes) : '',
      sortOrder: String(article?.sortOrder ?? 0),
    },
  });

  async function handleSubmit(values: ArticleFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        name: values.name,
        descriptionShort: values.descriptionShort,
        descriptionLong: values.descriptionLong === '' ? undefined : values.descriptionLong,
        photoUrl: values.photoUrl === '' ? undefined : values.photoUrl,
        basePrice: Number(values.basePrice.replace(',', '.')),
        vatPercent: Number(values.vatPercent),
        printDepartment: values.printDepartment,
        availability: values.availability,
        portata: values.portata,
        preparationTimeMinutes:
          values.preparationTimeMinutes === '' ? undefined : Number(values.preparationTimeMinutes),
        sortOrder: Number(values.sortOrder),
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = article !== undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.articleName')}</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="descriptionShort"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.descriptionShort')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="descriptionLong"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.descriptionLong')}</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="photoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.photoUrl')}</FormLabel>
              <FormControl>
                <Input type="url" placeholder="https://…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="basePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.basePrice')}</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vatPercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.vat')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {VAT_RATES.map((rate) => (
                      <option key={rate} value={String(rate)}>
                        {rate}%
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="printDepartment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.printDepartment')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {PRINT_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {t(`dept.${dept}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="availability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.availability')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {AVAILABILITIES.map((value) => (
                      <option key={value} value={value}>
                        {t(`avail.${value}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="portata"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.portata')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {PORTATE.map((value) => (
                      <option key={value} value={value}>
                        {t(`portata.${value}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="preparationTimeMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.prepTime')}</FormLabel>
                <FormControl>
                  <Input type="number" min={0} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sortOrder"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.sortOrder')}</FormLabel>
                <FormControl>
                  <Input type="number" min={0} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? isEdit
                ? t('saving')
                : t('creating')
              : isEdit
                ? t('save')
                : t('create')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            {t('cancel')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
