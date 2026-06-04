'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

// =============================================================================
// dashboard/page.tsx — Welcome page post-login (sotto (authenticated)/, STOP 6)
// =============================================================================
// Refactor estrazione (ADR-0018 Sub-DP-B):
// - Auth check + fetch /me → spostati in AuthContext (refresh on mount).
// - Logout server-side → estratto in lib/auth-logout.ts (pattern TD-6).
// - i18n: useTranslations('dashboard'), chiavi `dashboard.*`.
//
// STOP 6: pagina spostata sotto route group `(authenticated)/` — AuthGate +
// MainLayout (Sidebar + Topbar) provengono da parent layout. Page renderizza
// solo content; <main> outer fornito da MainLayout.
//
// Non-regression: testo "Welcome <firstName> <lastName>" + bottone "Esci"
// preservati identici per smoke esistenti (auth-login, auth-logout, auth-setup).
// =============================================================================

export default function DashboardPage(): JSX.Element {
  const t = useTranslations('dashboard');
  const { user, roles, permissions, error, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (error || !user) {
    return (
      <Alert variant="destructive" className="max-w-md">
        <AlertDescription>{error ?? t('profileUnavailable')}</AlertDescription>
      </Alert>
    );
  }

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    await logout();
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          {t('welcome', { firstName: user.firstName, lastName: user.lastName })}
        </CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section>
          <h3 className="font-semibold mb-2">{t('roles')}</h3>
          <ul className="text-sm text-muted-foreground">
            {roles.map((role) => (
              <li key={role.id}>• {role.name}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="font-semibold mb-2">
            {t('permissionsCount', { count: permissions.length })}
          </h3>
          <div className="flex flex-wrap gap-1">
            {permissions.map((perm) => (
              <span
                key={perm}
                className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded"
              >
                {perm}
              </span>
            ))}
          </div>
        </section>
        <Button onClick={handleLogout} variant="outline" className="w-full" disabled={isLoggingOut}>
          {isLoggingOut ? t('loggingOut') : t('logoutButton')}
        </Button>
      </CardContent>
    </Card>
  );
}
