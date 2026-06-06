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
import type { CreateMenuInput, Menu } from '@/lib/menu-types';

// =============================================================================
// MenuForm.tsx — Form create/edit Menu (S19 ADR-0020)
// =============================================================================
// RHF + zodResolver + components/ui/form.tsx (pattern login/page.tsx). Riusato
// sia per create (list page) sia per edit (detail page) — `menu` prop assente
// → create. Le regole zod replicano i vincoli CreateMenuDto backend; gli errori
// di conflitto server (es. E_MENU_NAME_EXISTS) arrivano via messageForError.
// =============================================================================

const menuFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Il nome deve avere almeno 2 caratteri')
    .max(100, 'Il nome non può superare 100 caratteri'),
  description: z.string().trim().max(500, 'La descrizione non può superare 500 caratteri'),
  isActive: z.boolean(),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d+$/, "L'ordine deve essere un numero intero maggiore o uguale a zero"),
});

type MenuFormValues = z.infer<typeof menuFormSchema>;

interface MenuFormProps {
  /** Menu esistente → modalità edit; assente → modalità create. */
  menu?: Menu;
  onSubmit: (input: CreateMenuInput) => Promise<void>;
  onCancel: () => void;
}

export function MenuForm({ menu, onSubmit, onCancel }: MenuFormProps): JSX.Element {
  const t = useTranslations('menu');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<MenuFormValues>({
    resolver: zodResolver(menuFormSchema),
    defaultValues: {
      name: menu?.name ?? '',
      description: menu?.description ?? '',
      isActive: menu?.isActive ?? true,
      sortOrder: String(menu?.sortOrder ?? 0),
    },
  });

  async function handleSubmit(values: MenuFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        name: values.name,
        description: values.description === '' ? undefined : values.description,
        isActive: values.isActive,
        sortOrder: Number(values.sortOrder),
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = menu !== undefined;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.description')}</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
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
        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                className="h-4 w-4 rounded border border-input"
              />
              {t('fields.isActive')}
            </label>
          )}
        />
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
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
