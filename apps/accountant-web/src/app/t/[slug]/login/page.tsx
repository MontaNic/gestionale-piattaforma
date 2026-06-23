'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gestionale/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@gestionale/ui';
import { Input } from '@gestionale/ui';
import { apiGet, apiPost, ApiError } from '@gestionale/api-client';
import { setTokens, type LoginResponse, type MeResponse } from '@gestionale/auth-web';
import { messageForErrorCode } from '@/lib/error-codes';

// TD-2 ADR-0012 resolution: slug runtime da URL (`/t/<slug>/login`) via
// useParams(). Middleware (src/middleware.ts) ha gia' validato il formato
// + reserved list prima di arrivare qui — il valore e' safe-to-use.

const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(8, 'Password troppo corta (min 8 caratteri)'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const tenantSlug = params.slug;
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      const response = await apiPost<LoginResponse>('/auth/login', values, { tenantSlug });
      setTokens(response.data.accessToken, response.data.refreshToken);
      // [ADR-0046 §4] Login unico, redirect post-login per tipo: operatore →
      // back-office studio, cliente → portale. Lo shape del JWT resta minimal →
      // il tipo arriva da /me (fresh).
      const me = await apiGet<MeResponse>('/me', { accessToken: response.data.accessToken });
      const dest = me.data.user.tipo === 'cliente' ? 'portale' : 'dashboard';
      router.push(`/t/${tenantSlug}/${dest}`);
    } catch (err) {
      if (err instanceof ApiError) {
        // TD-AJ: backend emette errorCode esplicito (auth.service.throwInvalidCredentials).
        // Mapping i18n-ready via ERROR_CODE_MESSAGES (lib/error-codes.ts).
        setServerError(messageForErrorCode(err.errorCode));
      } else {
        setServerError('Errore di connessione al server');
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accedi a Gestionale</CardTitle>
          <CardDescription>Inserisci le tue credenziali per continuare</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="admin@demo.local"
                        {...field}
                      />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
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
                {form.formState.isSubmitting ? 'Accesso in corso...' : 'Accedi'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
