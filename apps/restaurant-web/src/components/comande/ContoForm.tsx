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
import { CREATABLE_CHANNELS, type CreateContoInput } from '@/lib/conti-types';

// =============================================================================
// ContoForm.tsx — Form apertura conto (PR-1 comande, ADR-0068)
// =============================================================================
// RHF + zodResolver + components/ui/form.tsx (pattern MenuForm/ArticleForm).
// Solo canali NON-cassa (asporto/delivery/menu_online): `cassa` richiede un
// tavolo (coerenza D3) → apertura da tavolo in PR-2. `tavoloId` NON è inviato
// (i canali non-cassa lo vietano → E_CONTO_CHANNEL_TAVOLO_MISMATCH).
// =============================================================================

// Select nativo (no @radix-ui/react-select — confine "nessuna nuova dipendenza",
// stesso pattern di ArticleForm).
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const contoFormSchema = z.object({
  channel: z.enum(CREATABLE_CHANNELS),
  // coperti opzionale (DP-4): vuoto → undefined; se presente, intero ≥ 1.
  // Messaggio zod in italiano hardcoded, come MenuForm/ArticleForm (convenzione
  // restaurant-web: le validation zod non passano da next-intl).
  coperti: z
    .string()
    .trim()
    .regex(/^([1-9]\d*)?$/, 'I coperti devono essere un numero intero maggiore o uguale a 1'),
});

type ContoFormValues = z.infer<typeof contoFormSchema>;

interface ContoFormProps {
  onSubmit: (input: CreateContoInput) => Promise<void>;
  onCancel: () => void;
}

export function ContoForm({ onSubmit, onCancel }: ContoFormProps): JSX.Element {
  const t = useTranslations('comande');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ContoFormValues>({
    resolver: zodResolver(contoFormSchema),
    defaultValues: { channel: 'asporto', coperti: '' },
  });

  async function handleSubmit(values: ContoFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        channel: values.channel,
        coperti: values.coperti === '' ? undefined : Number(values.coperti),
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="channel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('form.channelLabel')}</FormLabel>
              <FormControl>
                <select className={SELECT_CLASS} {...field}>
                  {CREATABLE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`channel.${channel}`)}
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
          name="coperti"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('form.copertiLabel')}</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="—" {...field} />
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
            {form.formState.isSubmitting ? t('form.creating') : t('form.create')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            {t('form.cancel')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
