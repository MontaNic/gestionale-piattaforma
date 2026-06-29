'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import type { CreateTableInput, Tavolo } from '@/lib/table-types';

// =============================================================================
// TableForm.tsx — Form create/edit Tavolo (F2 Mappa sala, ADR-0058)
// =============================================================================
// RHF + zodResolver, schema dentro il componente (useMemo su [t]) per tradurre
// i messaggi via next-intl (pattern #134). Riusato per create (tavolo nasce a
// posX/posY 0, poi trascinabile) e per edit. Le coordinate NON sono nel form:
// si impostano col drag-drop sulla mappa. Gli errori server (E_TABLE_*) via
// messageForError.
// =============================================================================

interface TableFormProps {
  /** Tavolo esistente → modalità edit; assente → modalità create. */
  tavolo?: Tavolo;
  onSubmit: (input: CreateTableInput) => Promise<void>;
  onCancel: () => void;
}

export function TableForm({ tavolo, onSubmit, onCancel }: TableFormProps): JSX.Element {
  const t = useTranslations('tavoli');
  const [serverError, setServerError] = useState<string | null>(null);

  const tableFormSchema = useMemo(
    () =>
      z.object({
        numero: z
          .string()
          .trim()
          .min(1, t('validation.numeroRequired'))
          .max(50, t('validation.numeroMaxLength', { max: 50 })),
        // input type="number" → valore stringa; regex backstop = intero ≥ 1
        // (mirror del DTO backend @IsInt @Min(1)).
        capienza: z
          .string()
          .trim()
          .regex(/^[1-9]\d*$/, t('validation.capienzaInvalid')),
      }),
    [t],
  );

  type TableFormValues = z.infer<typeof tableFormSchema>;

  const form = useForm<TableFormValues>({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      numero: tavolo?.numero ?? '',
      capienza: String(tavolo?.capienza ?? 2),
    },
  });

  async function handleSubmit(values: TableFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({ numero: values.numero, capienza: Number(values.capienza) });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = tavolo !== undefined;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="numero"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.numero')}</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="capienza"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.capienza')}</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
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
