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
import { messageForError } from '@/lib/error-codes';
import type { CreateCategoryInput, MenuCategory } from '@/lib/menu-types';

// =============================================================================
// CategoryForm.tsx — Form create/edit MenuCategory (S19 ADR-0020)
// =============================================================================
// Inline nel detail menu (FASE 5). Vincoli zod allineati a CreateMenuCategoryDto.
// =============================================================================

const categoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Il nome deve avere almeno 2 caratteri')
    .max(100, 'Il nome non può superare 100 caratteri'),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d+$/, "L'ordine deve essere un numero intero maggiore o uguale a zero"),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryFormProps {
  /** Categoria esistente → modalità edit; assente → modalità create. */
  category?: MenuCategory;
  onSubmit: (input: CreateCategoryInput) => Promise<void>;
  onCancel: () => void;
}

export function CategoryForm({ category, onSubmit, onCancel }: CategoryFormProps): JSX.Element {
  const t = useTranslations('menu');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
    },
  });

  async function handleSubmit(values: CategoryFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({ name: values.name, sortOrder: Number(values.sortOrder) });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = category !== undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>{t('fields.categoryName')}</FormLabel>
                <FormControl>
                  <Input autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sortOrder"
            render={({ field }) => (
              <FormItem className="sm:w-32">
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
