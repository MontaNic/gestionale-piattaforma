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
} from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import type { CreateScadenzaCategoriaInput } from '@/lib/scadenze-types';

// =============================================================================
// CategoriaForm.tsx — Form create categoria scadenze custom (segue ADR-0040)
// =============================================================================
// Pattern derivato da ReferenteForm: zod + RHF, serverError interno via
// messageForError. Due soli campi: `nome` (required, max 100, mirror del DTO
// backend) + `colore` (input type="color" → sempre #RRGGBB valido, default
// #3b82f6 come lo schema). Solo create: il backend non espone update/delete
// categorie. Permesso richiesto a monte (sezione): scadenze.gestisci.
// =============================================================================

const DEFAULT_COLORE = '#3b82f6';

const categoriaFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Il nome è obbligatorio')
    .max(100, 'Il nome non può superare 100 caratteri'),
  // input type="color" garantisce sempre #rrggbb; il regex è backstop coerente
  // col DTO backend (Matches /^#[0-9a-fA-F]{6}$/).
  colore: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colore non valido'),
});

type CategoriaFormValues = z.infer<typeof categoriaFormSchema>;

interface CategoriaFormProps {
  onSubmit: (payload: CreateScadenzaCategoriaInput) => Promise<void>;
  onCancel: () => void;
}

export function CategoriaForm({ onSubmit, onCancel }: CategoriaFormProps): JSX.Element {
  const t = useTranslations('scadenze');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CategoriaFormValues>({
    resolver: zodResolver(categoriaFormSchema),
    defaultValues: {
      nome: '',
      colore: DEFAULT_COLORE,
    },
  });

  async function handleSubmit(values: CategoriaFormValues): Promise<void> {
    setServerError(null);
    try {
      await onSubmit({ nome: values.nome, colore: values.colore });
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3 rounded-md border bg-muted/30 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('categorie.fields.nome')}</FormLabel>
                <FormControl>
                  <Input autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="colore"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('categorie.fields.colore')}</FormLabel>
                <FormControl>
                  <Input type="color" className="h-10 w-16 p-1" {...field} />
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
            {form.formState.isSubmitting ? t('creating') : t('create')}
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
