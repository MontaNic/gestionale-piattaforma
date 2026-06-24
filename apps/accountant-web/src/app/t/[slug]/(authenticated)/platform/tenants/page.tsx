'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { z } from 'zod';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  cn,
} from '@gestionale/ui';
import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { messageForError } from '@/lib/error-codes';
import {
  createPlatformTenant,
  deletePlatformTenant,
  listPlatformTenants,
  restorePlatformTenant,
  suspendPlatformTenant,
} from '@/lib/platform-api';
import { PLATFORM_SLUG, type PlatformTenant } from '@/lib/platform-types';

// =============================================================================
// platform/tenants/page.tsx — superadmin tenant management (Commit 2 FE)
// =============================================================================
// Gated: visibile solo nel tenant `oneplatform` (slug === PLATFORM_SLUG); il BE
// rinforza con PlatformGuard (403 E_PLATFORM_FORBIDDEN). Lista tenant + stato +
// sospendi/riattiva/elimina + form creazione studio. Pattern clienti/page.
// =============================================================================

export default function PlatformTenantsPage(): JSX.Element {
  const t = useTranslations('platform');
  const params = useParams<{ slug: string }>();
  const isPlatform = params.slug === PLATFORM_SLUG;

  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PlatformTenant | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const schema = z.object({
    name: z.string().min(3, t('form.validationName')),
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,49}$/, t('form.validationSlug')),
    adminEmail: z.string().email(t('form.validationEmail')),
    adminPassword: z.string().min(8, t('form.validationPassword')),
    adminFirstName: z.string().min(1, t('form.validationFirstName')),
    adminLastName: z.string().min(1, t('form.validationLastName')),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      adminEmail: '',
      adminPassword: '',
      adminFirstName: '',
      adminLastName: '',
    },
  });

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setTenants(await listPlatformTenants());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatform) void load();
    else setIsLoading(false);
  }, [isPlatform, load]);

  // Gate client-side: fuori dal tenant di piattaforma non si mostra nulla.
  if (!isPlatform) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Alert variant="destructive">
          <AlertDescription>{t('forbidden')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  async function onCreate(values: FormValues): Promise<void> {
    setCreateError(null);
    try {
      await createPlatformTenant(values);
    } catch (err) {
      setCreateError(messageForError(err));
      return;
    }
    form.reset();
    setCreating(false);
    await load();
  }

  async function toggleActive(tenant: PlatformTenant): Promise<void> {
    setBusyId(tenant.id);
    setLoadError(null);
    try {
      if (tenant.isActive) await suspendPlatformTenant(tenant.id);
      else await restorePlatformTenant(tenant.id);
    } catch (err) {
      setLoadError(messageForError(err));
    }
    setBusyId(null);
    await load();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deletePlatformTenant(pendingDelete.id);
    } catch (err) {
      setLoadError(messageForError(err));
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
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
            {t('newTenant')}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('form.name')} error={form.formState.errors.name?.message}>
                  <Input {...form.register('name')} />
                </Field>
                <Field
                  label={t('form.slug')}
                  hint={t('form.slugHint')}
                  error={form.formState.errors.slug?.message}
                >
                  <Input {...form.register('slug')} />
                </Field>
                <Field
                  label={t('form.adminEmail')}
                  error={form.formState.errors.adminEmail?.message}
                >
                  <Input type="email" autoComplete="off" {...form.register('adminEmail')} />
                </Field>
                <Field
                  label={t('form.adminPassword')}
                  error={form.formState.errors.adminPassword?.message}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    {...form.register('adminPassword')}
                  />
                </Field>
                <Field
                  label={t('form.adminFirstName')}
                  error={form.formState.errors.adminFirstName?.message}
                >
                  <Input {...form.register('adminFirstName')} />
                </Field>
                <Field
                  label={t('form.adminLastName')}
                  error={form.formState.errors.adminLastName?.message}
                >
                  <Input {...form.register('adminLastName')} />
                </Field>
              </div>
              {createError && (
                <Alert variant="destructive">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? t('form.submitting') : t('form.submit')}
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
                  {t('form.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : tenants.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('col.name')}</th>
                <th className="px-3 py-2 font-medium">{t('col.slug')}</th>
                <th className="px-3 py-2 font-medium">{t('col.stato')}</th>
                <th className="px-3 py-2 font-medium">{t('col.creato')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.azioni')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tn) => {
                const isPlatformRow = tn.slug === PLATFORM_SLUG;
                return (
                  <tr key={tn.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{tn.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{tn.slug}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          tn.isActive
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {tn.isActive ? t('stato.attivo') : t('stato.sospeso')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(tn.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Il tenant di piattaforma non è modificabile (self-protection BE). */}
                      {!isPlatformRow && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={tn.isActive ? t('actions.suspend') : t('actions.restore')}
                            disabled={busyId === tn.id}
                            onClick={() => void toggleActive(tn)}
                          >
                            {tn.isActive ? (
                              <PowerOff className="h-4 w-4" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('actions.delete')}
                            onClick={() => setPendingDelete(tn)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.deleteTitle')}
        description={pendingDelete ? t('confirm.deleteBody', { name: pendingDelete.name }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
