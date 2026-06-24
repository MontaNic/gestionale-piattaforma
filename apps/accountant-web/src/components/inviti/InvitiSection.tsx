'use client';

import { useCallback, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Alert, AlertDescription, Button, Card, CardContent, Input, Label } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { createInvito, listInviti, revokeInvito } from '@/lib/inviti-api';
import { messageForError } from '@/lib/error-codes';
import type { Invito } from '@/lib/inviti-types';

// =============================================================================
// InvitiSection.tsx — pannello inviti cliente nella detail azienda (Commit 2 FE)
// =============================================================================
// Embedded in clienti/[id]. Consuma /aziende/:aziendaId/inviti. Stato React
// locale + refetch on mutation (pattern ReferentiSection). Gated sul permesso
// `clienti.invitare`: senza permesso la sezione non viene renderizzata.
// Form inline: email + checkbox "invita come admin" (clienteRuolo). Revoca con
// ConfirmDialog → l'invito sparisce dai pendenti.
// =============================================================================

interface InvitiSectionProps {
  aziendaId: string;
}

export function InvitiSection({ aziendaId }: InvitiSectionProps): JSX.Element | null {
  const t = useTranslations('inviti');
  const { permissions } = useAuth();
  const canInvite = permissions.includes('clienti.invitare');

  const [inviti, setInviti] = useState<Invito[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Invito | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const schema = z.object({
    email: z.string().email(t('validationEmail')),
    admin: z.boolean(),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', admin: false },
  });

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setInviti(await listInviti(aziendaId));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [aziendaId]);

  useEffect(() => {
    if (canInvite) void load();
  }, [canInvite, load]);

  // Niente sezione per chi non ha il permesso (es. Collaboratore/Segreteria).
  if (!canInvite) return null;

  async function onCreate(values: FormValues): Promise<void> {
    setCreateError(null);
    try {
      await createInvito(aziendaId, {
        email: values.email,
        clienteRuolo: values.admin ? 'admin' : 'utente',
      });
    } catch (err) {
      setCreateError(messageForError(err));
      return;
    }
    form.reset();
    setCreating(false);
    await load();
  }

  async function handleConfirmRevoke(): Promise<void> {
    if (!pendingRevoke) return;
    setIsRevoking(true);
    try {
      await revokeInvito(aziendaId, pendingRevoke.id);
    } catch (err) {
      setLoadError(messageForError(err));
    }
    setPendingRevoke(null);
    setIsRevoking(false);
    await load();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('sectionTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('sectionSubtitle')}</p>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => {
              setCreateError(null);
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('newInvito')}
          </Button>
        )}
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {creating && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="invito-email">{t('emailLabel')}</Label>
                <Input
                  id="invito-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('emailPlaceholder')}
                  {...form.register('email')}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  {...form.register('admin')}
                />
                {t('adminLabel')}
              </label>
              {createError && (
                <Alert variant="destructive">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? t('submitting') : t('submit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    setCreateError(null);
                    setCreating(false);
                  }}
                >
                  {t('cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : inviti.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('col.email')}</th>
                <th className="px-3 py-2 font-medium">{t('col.ruolo')}</th>
                <th className="px-3 py-2 font-medium">{t('col.scadenza')}</th>
                <th className="px-3 py-2 font-medium">{t('col.invitatoDa')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.azioni')}</th>
              </tr>
            </thead>
            <tbody>
              {inviti.map((inv) => (
                <tr key={inv.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{inv.email}</td>
                  <td className="px-3 py-2">{t(`ruolo.${inv.clienteRuolo}`)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {inv.invitatoDa.firstName} {inv.invitatoDa.lastName}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('revoke')}
                      onClick={() => setPendingRevoke(inv)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={t('confirm.title')}
        description={pendingRevoke ? t('confirm.body', { email: pendingRevoke.email }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmRevoke()}
        isPending={isRevoking}
      />
    </section>
  );
}
