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
  Textarea,
} from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import { RUOLI_REFERENTE, type Referente, type ReferenteFormPayload } from '@/lib/referenti-types';

// =============================================================================
// ReferenteForm.tsx — Form create/edit referente (STOP-c3b ADR-0034)
// =============================================================================
// 6 campi MVP. Pattern derivato da AziendaForm: zod + RHF, select nativo per
// l'enum ruolo (no nuova dipendenza), serverError interno via messageForError.
// Campi opzionali stringa: '' nel form → undefined al submit.
// =============================================================================

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

// Validazione email "opzionale": '' ammessa, altrimenti formato + lunghezza.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ReferenteFormProps {
  /** Referente esistente → modalità edit; assente → modalità create. */
  referente?: Referente;
  onSubmit: (payload: ReferenteFormPayload) => Promise<void>;
  onCancel: () => void;
}

/** '' → undefined per i campi stringa opzionali. */
function clean(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function ReferenteForm({ referente, onSubmit, onCancel }: ReferenteFormProps): JSX.Element {
  const t = useTranslations('referenti');
  const [serverError, setServerError] = useState<string | null>(null);

  // Schema dentro il componente per tradurre i messaggi via `t`; memoizzato su [t].
  const referenteFormSchema = useMemo(
    () =>
      z.object({
        nome: z
          .string()
          .trim()
          .min(1, t('validation.nomeRequired'))
          .max(150, t('validation.nomeMaxLength', { max: 150 })),
        ruolo: z.enum(['legale_rappresentante', 'amministrativo', 'tecnico', 'altro']),
        email: z
          .string()
          .trim()
          .max(255, t('validation.emailMaxLength', { max: 255 }))
          .refine((v) => v === '' || EMAIL_RE.test(v), t('validation.emailInvalid')),
        telefono: z
          .string()
          .trim()
          .max(40, t('validation.maxLength', { max: 40 })),
        note: z
          .string()
          .trim()
          .max(255, t('validation.maxLength', { max: 255 })),
        attivo: z.boolean(),
      }),
    [t],
  );

  type ReferenteFormValues = z.infer<typeof referenteFormSchema>;

  const form = useForm<ReferenteFormValues>({
    resolver: zodResolver(referenteFormSchema),
    defaultValues: {
      nome: referente?.nome ?? '',
      ruolo: referente?.ruolo ?? 'altro',
      email: referente?.email ?? '',
      telefono: referente?.telefono ?? '',
      note: referente?.note ?? '',
      attivo: referente?.attivo ?? true,
    },
  });

  async function handleSubmit(values: ReferenteFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        nome: values.nome,
        ruolo: values.ruolo,
        email: clean(values.email),
        telefono: clean(values.telefono),
        note: clean(values.note),
        attivo: values.attivo,
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = referente !== undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.nome')}</FormLabel>
                <FormControl>
                  <Input autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ruolo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.ruolo')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {RUOLI_REFERENTE.map((r) => (
                      <option key={r} value={r}>
                        {t(`ruolo.${r}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.email')}</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="telefono"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.telefono')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.note')}</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="attivo"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2 space-y-0">
              <FormControl>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  name={field.name}
                  ref={field.ref}
                  checked={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              </FormControl>
              <FormLabel className="!mt-0">{t('fields.attivo')}</FormLabel>
            </FormItem>
          )}
        />

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
