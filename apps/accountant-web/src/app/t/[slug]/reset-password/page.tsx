'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gestionale/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@gestionale/ui';
import { Input } from '@gestionale/ui';
import { apiPost, ApiError } from '@gestionale/api-client';
import { messageForErrorCode } from '@/lib/error-codes';

// =============================================================================
// reset-password/page.tsx — consumo token + nuova password (Commit 2 FE)
// =============================================================================
// Pubblica (sibling di /login). Token dal query param `?token=...` (link email).
// Stesso pattern di login/page.tsx (apiPost inline, errorCode →
// messageForErrorCode). Chrome via next-intl (namespace `auth.resetPassword`).
//
// Validazione client zod: lunghezza min 8 (specchio del backend) + conferma.
// Il backend ri-valida e emette E_AUTH_RESET_TOKEN_INVALID/EXPIRED /
// E_AUTH_PASSWORD_TOO_SHORT (mappati IT in lib/error-codes).
// =============================================================================

export default function ResetPasswordPage(): JSX.Element {
  const params = useParams<{ slug: string }>();
  const tenantSlug = params.slug;
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const t = useTranslations('auth.resetPassword');
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const schema = z
    .object({
      password: z.string().min(8, t('validationTooShort')),
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
      message: t('validationMismatch'),
      path: ['confirmPassword'],
    });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setServerError(null);
    try {
      await apiPost<{ data: { success: boolean } }>(
        '/auth/reset-password',
        { token, newPassword: values.password },
        { tenantSlug },
      );
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(messageForErrorCode(err.errorCode));
      } else {
        setServerError(t('connectionError'));
      }
    }
  }

  // Token assente nel link: nessun form, invito a richiedere un nuovo reset.
  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>{t('tokenMissing')}</AlertDescription>
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/t/${tenantSlug}/forgot-password`}>{t('requestNew')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{done ? t('successTitle') : t('title')}</CardTitle>
          <CardDescription>{done ? t('successBody') : t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <Button asChild className="w-full">
              <Link href={`/t/${tenantSlug}/login`}>{t('goToLogin')}</Link>
            </Button>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('passwordLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('passwordPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('confirmLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('confirmPlaceholder')}
                          {...field}
                        />
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
                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? t('submitting') : t('submit')}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
