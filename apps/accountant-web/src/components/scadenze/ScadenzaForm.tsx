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
import type { Azienda } from '@/lib/aziende-types';
import {
  VISIBILITA_SCADENZA,
  type Scadenza,
  type ScadenzaCategoria,
  type ScadenzaFormPayload,
} from '@/lib/scadenze-types';

// =============================================================================
// ScadenzaForm.tsx — Form create/edit scadenza calendario fiscale (STOP-scad2)
// =============================================================================
// Pattern derivato da AziendaForm: zod + RHF, `<select>` nativo per gli enum
// (SELECT_CLASS locale, niente @radix-ui/react-select — confine "nessuna nuova
// dipendenza"), serverError interno via messageForError. Campi opzionali stringa:
// '' nel form → undefined al submit (`clean`).
//
// Regola business mirror del service (ADR-0039): visibilita='azienda' ⇒ aziendaId
// obbligatorio. Il select azienda è visibile SOLO con visibilita='azienda';
// cambiando visibilità verso 'tutti'/'utente' si azzera aziendaId nel form.
// Categorie (piattaforma + custom) e aziende sono iniettate dalla page (fetch
// unico) per popolare i select — la lista scadenze non porta relazioni embedded.
// =============================================================================

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface ScadenzaFormProps {
  /** Scadenza esistente → modalità edit; assente → modalità create. */
  scadenza?: Scadenza;
  categorie: ScadenzaCategoria[];
  aziende: Azienda[];
  onSubmit: (payload: ScadenzaFormPayload) => Promise<void>;
  onCancel: () => void;
}

/** '' → undefined per i campi stringa opzionali. */
function clean(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function ScadenzaForm({
  scadenza,
  categorie,
  aziende,
  onSubmit,
  onCancel,
}: ScadenzaFormProps): JSX.Element {
  const t = useTranslations('scadenze');
  const [serverError, setServerError] = useState<string | null>(null);

  // Schema dentro il componente per tradurre i messaggi via `t`; memoizzato su [t].
  const scadenzaFormSchema = useMemo(
    () =>
      z
        .object({
          titolo: z
            .string()
            .trim()
            .min(1, t('validation.titoloRequired'))
            .max(255, t('validation.titoloMaxLength', { max: 255 })),
          descrizione: z.string().trim(),
          dataScadenza: z.string().min(1, t('validation.dataRequired')),
          categoriaId: z.string(),
          visibilita: z.enum(['tutti', 'azienda', 'utente']),
          aziendaId: z.string(),
          attivo: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (v.visibilita === 'azienda' && v.aziendaId.trim() === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['aziendaId'],
              message: t('validation.aziendaRequiredForVisibility'),
            });
          }
        }),
    [t],
  );

  type ScadenzaFormValues = z.infer<typeof scadenzaFormSchema>;

  const form = useForm<ScadenzaFormValues>({
    resolver: zodResolver(scadenzaFormSchema),
    defaultValues: {
      titolo: scadenza?.titolo ?? '',
      descrizione: scadenza?.descrizione ?? '',
      dataScadenza: scadenza?.dataScadenza ?? '',
      categoriaId: scadenza?.categoriaId ?? '',
      visibilita: scadenza?.visibilita ?? 'tutti',
      aziendaId: scadenza?.aziendaId ?? '',
      attivo: scadenza?.attivo ?? true,
    },
  });

  const visibilita = form.watch('visibilita');

  async function handleSubmit(values: ScadenzaFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        titolo: values.titolo,
        descrizione: clean(values.descrizione),
        dataScadenza: values.dataScadenza,
        categoriaId: clean(values.categoriaId),
        visibilita: values.visibilita,
        // aziendaId rilevante solo per visibilita='azienda'; altrimenti omesso.
        aziendaId: values.visibilita === 'azienda' ? clean(values.aziendaId) : undefined,
        attivo: values.attivo,
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = scadenza !== undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <FormField
          control={form.control}
          name="titolo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.titolo')}</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="descrizione"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.descrizione')}</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="dataScadenza"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.dataScadenza')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="categoriaId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.categoria')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    <option value="">{t('fields.categoriaNone')}</option>
                    {categorie.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
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
            name="visibilita"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.visibilita')}</FormLabel>
                <FormControl>
                  <select
                    className={SELECT_CLASS}
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      // Cambiando verso 'tutti'/'utente' azzera l'azienda: non
                      // è più rilevante e va liberata per il submit.
                      if (e.target.value !== 'azienda') {
                        form.setValue('aziendaId', '', { shouldValidate: true });
                      }
                    }}
                  >
                    {VISIBILITA_SCADENZA.map((vis) => (
                      <option key={vis} value={vis}>
                        {t(`visibilita.${vis}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {visibilita === 'azienda' && (
            <FormField
              control={form.control}
              name="aziendaId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.azienda')}</FormLabel>
                  <FormControl>
                    <select className={SELECT_CLASS} {...field}>
                      <option value="">{t('fields.aziendaPlaceholder')}</option>
                      {aziende.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

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
