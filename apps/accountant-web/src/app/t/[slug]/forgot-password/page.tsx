'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
// forgot-password/page.tsx — richiesta link di reset (Commit 2 FE)
// =============================================================================
// Pubblica (sibling di /login, fuori da (authenticated)). Tenant slug runtime
// da useParams (middleware ha gia' validato). Stesso pattern di login/page.tsx
// (apiPost inline, errorCode → messageForErrorCode). Chrome via next-intl
// (namespace `auth.forgotPassword`).
//
// No oracle: la response e' sempre 200; mostriamo un messaggio neutro ("se
// l'account esiste...") senza rivelare se l'email e' registrata.
// =============================================================================

export default function ForgotPasswordPage(): JSX.Element {
  const params = useParams<{ slug: string }>();
  const tenantSlug = params.slug;
  const t = useTranslations('auth.forgotPassword');
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const schema = z.object({
    email: z.string().email(t('validationEmail')),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setServerError(null);
    try {
      await apiPost<{ data: { success: boolean } }>('/auth/forgot-password', values, {
        tenantSlug,
      });
      // No oracle: successo neutro a prescindere dall'esistenza dell'email.
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(messageForErrorCode(err.errorCode));
      } else {
        setServerError(t('connectionError'));
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{submitted ? t('successTitle') : t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>{t('successBody')}</AlertDescription>
              </Alert>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/t/${tenantSlug}/login`}>{t('backToLogin')}</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('emailLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder={t('emailPlaceholder')}
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
                <Button asChild variant="link" className="w-full">
                  <Link href={`/t/${tenantSlug}/login`}>{t('backToLogin')}</Link>
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
