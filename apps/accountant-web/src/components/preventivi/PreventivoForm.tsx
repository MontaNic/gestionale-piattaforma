'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import {
  VociEditor,
  emptyRow,
  isValidAmount,
  rowFromVoce,
  rowToVoceInput,
  type VoceRow,
} from '@/components/preventivi/VociEditor';
import { messageForError } from '@/lib/error-codes';
import { createPreventivo, deletePreventivo, updatePreventivo } from '@/lib/preventivi-api';
import {
  STATI_PREVENTIVO,
  type CreatePreventivoInput,
  type PreventivoWithVoci,
} from '@/lib/preventivi-types';

// =============================================================================
// PreventivoForm.tsx — Editor preventivo: testata RHF+zod + voci (STOP-e2 ADR-0037)
// =============================================================================
// Orchestratore delle route nuovo/[preventivoId]. Testata in react-hook-form +
// zod (pattern AziendaForm/ReferenteForm); voci in useState<VoceRow[]> gestite
// da VociEditor (DP-editor-voci=ibrido). Submit: valida le righe (≥1, nome +
// qta/prezzo parsabili), compone Create/UpdatePreventivoInput con Number()
// conversion (ordine = index), chiama l'API, redirect alla detail cliente (dove
// la PreventiviSection lista). Delete (solo edit) via ConfirmDialog riusato.
// I 3 totali NON sono in request: il server li ricalcola dalle voci.
// =============================================================================

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const testataSchema = z.object({
  codice: z
    .string()
    .trim()
    .min(1, 'Il codice è obbligatorio')
    .max(32, 'Il codice non può superare 32 caratteri'),
  oggetto: z
    .string()
    .trim()
    .min(1, "L'oggetto è obbligatorio")
    .max(200, "L'oggetto non può superare 200 caratteri"),
  // `convertito` (ADR-0051) incluso per type-match con StatoPreventivo (lo
  // imposta il backend); NON è nel select (STATI_PREVENTIVO ha solo i 4 manuali).
  stato: z.enum(['bozza', 'inviato', 'accettato', 'rifiutato', 'convertito']),
  validoFino: z.string().trim(),
  coverLetter: z.string().trim(),
  noteInterne: z.string().trim(),
});

type TestataValues = z.infer<typeof testataSchema>;

/** '' → undefined per i campi stringa opzionali. */
function clean(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

interface PreventivoFormProps {
  aziendaId: string;
  slug: string;
  mode: 'create' | 'edit';
  /** Presente in edit; popola testata + righe. */
  preventivo?: PreventivoWithVoci;
}

export function PreventivoForm({
  aziendaId,
  slug,
  mode,
  preventivo,
}: PreventivoFormProps): JSX.Element {
  const t = useTranslations('preventivi');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [vociError, setVociError] = useState<string | null>(null);
  const [rows, setRows] = useState<VoceRow[]>(
    preventivo ? preventivo.voci.map(rowFromVoce) : [emptyRow()],
  );
  const [pendingDelete, setPendingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const detailHref = `/t/${slug}/clienti/${aziendaId}`;

  const form = useForm<TestataValues>({
    resolver: zodResolver(testataSchema),
    defaultValues: {
      codice: preventivo?.codice ?? '',
      oggetto: preventivo?.oggetto ?? '',
      stato: preventivo?.stato ?? 'bozza',
      validoFino: preventivo?.validoFino ?? '',
      coverLetter: preventivo?.coverLetter ?? '',
      noteInterne: preventivo?.noteInterne ?? '',
    },
  });

  /** Valida le righe lato client (mirror leggero dei vincoli DTO). */
  function validateRows(): string | null {
    if (rows.length === 0) return t('voci.errorEmpty');
    for (const r of rows) {
      if (r.nome.trim() === '') return t('voci.errorNome');
      if (!isValidAmount(r.quantita) || !isValidAmount(r.prezzoUnitario)) {
        return t('voci.errorAmount');
      }
    }
    return null;
  }

  async function handleSubmit(values: TestataValues): Promise<void> {
    setServerError(null);
    const rowsError = validateRows();
    setVociError(rowsError);
    if (rowsError) return;

    const payload: CreatePreventivoInput = {
      codice: values.codice,
      oggetto: values.oggetto,
      stato: values.stato,
      validoFino: clean(values.validoFino),
      coverLetter: clean(values.coverLetter),
      noteInterne: clean(values.noteInterne),
      voci: rows.map((r, i) => rowToVoceInput(r, i)),
    };

    try {
      if (mode === 'edit' && preventivo) {
        await updatePreventivo(aziendaId, preventivo.id, payload);
      } else {
        await createPreventivo(aziendaId, payload);
      }
      router.push(detailHref);
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!preventivo) return;
    setIsDeleting(true);
    setServerError(null);
    try {
      await deletePreventivo(aziendaId, preventivo.id);
      router.push(detailHref);
    } catch (err) {
      setServerError(messageForError(err));
      setPendingDelete(false);
      setIsDeleting(false);
    }
  }

  const isEdit = mode === 'edit';

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* ── Testata ──────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border bg-muted/30 p-4">
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
              name="stato"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.stato')}</FormLabel>
                  <FormControl>
                    <select className={SELECT_CLASS} {...field}>
                      {STATI_PREVENTIVO.map((s) => (
                        <option key={s} value={s}>
                          {t(`stato.${s}`)}
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
            name="oggetto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.oggetto')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="validoFino"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.validoFino')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="coverLetter"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.coverLetter')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="noteInterne"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.noteInterne')}</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* ── Voci ─────────────────────────────────────────────────────── */}
        <VociEditor rows={rows} onChange={setRows} disabled={form.formState.isSubmitting} />
        {vociError && (
          <Alert variant="destructive">
            <AlertDescription>{vociError}</AlertDescription>
          </Alert>
        )}

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {/* ── Azioni ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => router.push(detailHref)}
            disabled={form.formState.isSubmitting}
          >
            {t('cancel')}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              className="ml-auto"
              onClick={() => setPendingDelete(true)}
              disabled={form.formState.isSubmitting}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(false);
        }}
        title={t('confirm.title')}
        description={preventivo ? t('confirm.body', { codice: preventivo.codice }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </Form>
  );
}
