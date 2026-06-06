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
import {
  CHANNELS,
  type Channel,
  type CreatePriceListInput,
  type PriceList,
} from '@/lib/menu-types';

// =============================================================================
// PriceListForm.tsx — Form create/edit PriceList (S20 ADR-0022)
// =============================================================================
// RHF + zodResolver + components/ui/form.tsx (pattern MenuForm S19). `priceList`
// prop assente → create. `channels` è un multi-select reso con checkbox native
// (confine "nessuna nuova dipendenza" S19 — niente @radix-ui/react-select).
// Le date `validFrom/validTo` viaggiano come stringa `YYYY-MM-DD` (DTO backend
// `@Type(() => Date)`); stringa vuota → `undefined` (campo non impostato).
// =============================================================================

const priceListFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Il nome deve avere almeno 2 caratteri')
      .max(100, 'Il nome non può superare 100 caratteri'),
    channels: z
      .array(z.enum(['cassa', 'menu_online', 'asporto', 'delivery']))
      .min(1, 'Seleziona almeno un canale'),
    priority: z
      .string()
      .trim()
      .regex(/^\d+$/, 'La priorità deve essere un numero intero maggiore o uguale a zero'),
    isActive: z.boolean(),
    validFromDate: z.string().trim(),
    validToDate: z.string().trim(),
  })
  .refine(
    (v) => v.validFromDate === '' || v.validToDate === '' || v.validFromDate <= v.validToDate,
    {
      message: 'La data di fine deve essere successiva alla data di inizio',
      path: ['validToDate'],
    },
  );

type PriceListFormValues = z.infer<typeof priceListFormSchema>;

interface PriceListFormProps {
  /** Listino esistente → modalità edit; assente → modalità create. */
  priceList?: PriceList;
  onSubmit: (input: CreatePriceListInput) => Promise<void>;
  onCancel: () => void;
}

export function PriceListForm({ priceList, onSubmit, onCancel }: PriceListFormProps): JSX.Element {
  const t = useTranslations('menu');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<PriceListFormValues>({
    resolver: zodResolver(priceListFormSchema),
    defaultValues: {
      name: priceList?.name ?? '',
      channels: priceList?.channels ?? [],
      priority: String(priceList?.priority ?? 0),
      isActive: priceList?.isActive ?? true,
      // `@db.Date` serializzata come ISO datetime → tronco al solo giorno per <input type="date">.
      validFromDate: priceList?.validFromDate?.slice(0, 10) ?? '',
      validToDate: priceList?.validToDate?.slice(0, 10) ?? '',
    },
  });

  async function handleSubmit(values: PriceListFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        name: values.name,
        channels: values.channels,
        priority: Number(values.priority),
        isActive: values.isActive,
        validFromDate: values.validFromDate === '' ? undefined : values.validFromDate,
        validToDate: values.validToDate === '' ? undefined : values.validToDate,
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = priceList !== undefined;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.priceListName')}</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="channels"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.channels')}</FormLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {CHANNELS.map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={field.value.includes(channel)}
                      onChange={(e) =>
                        field.onChange(
                          e.target.checked
                            ? [...field.value, channel]
                            : field.value.filter((c: Channel) => c !== channel),
                        )
                      }
                      className="h-4 w-4 rounded border border-input"
                    />
                    {t(`channels.${channel}`)}
                  </label>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="validFromDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.validFrom')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="validToDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.validTo')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.priority')}</FormLabel>
                <FormControl>
                  <Input type="number" min={0} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
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
              {t('fields.isActiveList')}
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
