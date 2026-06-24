'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import { setTokens, type LoginResponse } from '@gestionale/auth-web';
import { messageForErrorCode } from '@/lib/error-codes';

// =============================================================================
// accept-invite/page.tsx — registrazione cliente da invito (Commit 2 FE)
// =============================================================================
// Pubblica (sibling di /login). Token dal query param `?token=...` (link email).
// Form nome/cognome/password (+ conferma). Il backend crea l'utente cliente e
// ritorna i tokens (auto-login) → redirect al portale autenticato. Chrome via
// next-intl (namespace `acceptInvite`); errori server via messageForErrorCode.
// =============================================================================

export default function AcceptInvitePage(): JSX.Element {
  const params = useParams<{ slug: string }>();
  const tenantSlug = params.slug;
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const t = useTranslations('acceptInvite');
  const [serverError, setServerError] = useState<string | null>(null);

  const schema = z
    .object({
      firstName: z.string().min(1, t('validationFirstName')),
      lastName: z.string().min(1, t('validationLastName')),
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
    defaultValues: { firstName: '', lastName: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setServerError(null);
    try {
      const res = await apiPost<LoginResponse>(
        '/auth/accept-invite',
        {
          token,
          password: values.password,
          firstName: values.firstName,
          lastName: values.lastName,
        },
        { tenantSlug },
      );
      // Auto-login: il backend ha già creato l'utente cliente e ritorna i tokens.
      setTokens(res.data.accessToken, res.data.refreshToken);
      router.push(`/t/${tenantSlug}/portale`);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(messageForErrorCode(err.errorCode));
      } else {
        setServerError(t('connectionError'));
      }
    }
  }

  // Token assente nel link: nessun form.
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
              <Link href={`/t/${tenantSlug}/login`}>{t('goToLogin')}</Link>
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
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('firstNameLabel')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('lastNameLabel')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                        placeholder={t('passwordPlaceholder')}
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
        </CardContent>
      </Card>
    </main>
  );
}
