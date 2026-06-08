'use client';

import { useState } from 'react';
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
import { TIPI_CLIENTE, type Azienda, type AziendaFormPayload } from '@/lib/aziende-types';

// =============================================================================
// AziendaForm.tsx — Form create/edit anagrafica cliente (STOP-c2 ADR-0032)
// =============================================================================
// 15 campi MVP. Pattern derivato da ArticleForm (restaurant-web): zod + RHF,
// select nativo per gli enum (no @radix-ui/react-select — confine "nessuna
// nuova dipendenza"), serverError interno via messageForError. Campi opzionali
// stringa: '' nel form → undefined al submit.
// =============================================================================

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

// Validazione email "opzionale": '' ammessa, altrimenti formato + lunghezza.
// Mantiene il tipo string in/out (no preprocess) per inferenza zodResolver pulita.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function optionalEmail(label: string) {
  return z
    .string()
    .trim()
    .max(255, `${label}: massimo 255 caratteri`)
    .refine((v) => v === '' || EMAIL_RE.test(v), `${label} non valida`);
}

const aziendaFormSchema = z.object({
  codice: z
    .string()
    .trim()
    .min(1, 'Il codice è obbligatorio')
    .max(20, 'Il codice non può superare 20 caratteri'),
  nome: z
    .string()
    .trim()
    .min(1, 'Il nome è obbligatorio')
    .max(200, 'Il nome non può superare 200 caratteri'),
  tipoCliente: z.enum(['azienda', 'persona_fisica']),
  partitaIva: z.string().trim().max(20, 'Massimo 20 caratteri'),
  codiceFiscale: z.string().trim().max(20, 'Massimo 20 caratteri'),
  codiceAteco: z.string().trim().max(20, 'Massimo 20 caratteri'),
  email: optionalEmail('Email'),
  emailOperativa: optionalEmail('Email operativa'),
  pec: optionalEmail('PEC'),
  sitoWeb: z.string().trim().max(255, 'Massimo 255 caratteri'),
  telefono: z.string().trim().max(40, 'Massimo 40 caratteri'),
  telefono2: z.string().trim().max(40, 'Massimo 40 caratteri'),
  indirizzo: z.string().trim().max(255, 'Massimo 255 caratteri'),
  noteOperative: z.string().trim(),
  attivo: z.boolean(),
});

type AziendaFormValues = z.infer<typeof aziendaFormSchema>;

interface AziendaFormProps {
  /** Azienda esistente → modalità edit; assente → modalità create. */
  azienda?: Azienda;
  onSubmit: (payload: AziendaFormPayload) => Promise<void>;
  onCancel: () => void;
}

/** '' → undefined per i campi stringa opzionali. */
function clean(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function AziendaForm({ azienda, onSubmit, onCancel }: AziendaFormProps): JSX.Element {
  const t = useTranslations('aziende');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AziendaFormValues>({
    resolver: zodResolver(aziendaFormSchema),
    defaultValues: {
      codice: azienda?.codice ?? '',
      nome: azienda?.nome ?? '',
      tipoCliente: azienda?.tipoCliente ?? 'azienda',
      partitaIva: azienda?.partitaIva ?? '',
      codiceFiscale: azienda?.codiceFiscale ?? '',
      codiceAteco: azienda?.codiceAteco ?? '',
      email: azienda?.email ?? '',
      emailOperativa: azienda?.emailOperativa ?? '',
      pec: azienda?.pec ?? '',
      sitoWeb: azienda?.sitoWeb ?? '',
      telefono: azienda?.telefono ?? '',
      telefono2: azienda?.telefono2 ?? '',
      indirizzo: azienda?.indirizzo ?? '',
      noteOperative: azienda?.noteOperative ?? '',
      attivo: azienda?.attivo ?? true,
    },
  });

  async function handleSubmit(values: AziendaFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({
        codice: values.codice,
        nome: values.nome,
        tipoCliente: values.tipoCliente,
        partitaIva: clean(values.partitaIva),
        codiceFiscale: clean(values.codiceFiscale),
        codiceAteco: clean(values.codiceAteco),
        email: clean(values.email),
        emailOperativa: clean(values.emailOperativa),
        pec: clean(values.pec),
        sitoWeb: clean(values.sitoWeb),
        telefono: clean(values.telefono),
        telefono2: clean(values.telefono2),
        indirizzo: clean(values.indirizzo),
        noteOperative: clean(values.noteOperative),
        attivo: values.attivo,
      });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const isEdit = azienda !== undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="codice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.codice')}</FormLabel>
                <FormControl>
                  <Input autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tipoCliente"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.tipoCliente')}</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    {TIPI_CLIENTE.map((tc) => (
                      <option key={tc} value={tc}>
                        {t(`tipo.${tc}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="nome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.nome')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="partitaIva"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.partitaIva')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="codiceFiscale"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.codiceFiscale')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="codiceAteco"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.codiceAteco')}</FormLabel>
                <FormControl>
                  <Input {...field} />
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
            name="emailOperativa"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.emailOperativa')}</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pec"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.pec')}</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sitoWeb"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.sitoWeb')}</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…" {...field} />
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
          <FormField
            control={form.control}
            name="telefono2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.telefono2')}</FormLabel>
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
          name="indirizzo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.indirizzo')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="noteOperative"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.noteOperative')}</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
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
