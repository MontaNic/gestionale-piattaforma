'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { clearTokens, getAccessToken } from '@/lib/auth';
import type { MeResponse } from '@/lib/types';

type Profile = MeResponse['data'];

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    apiGet<MeResponse>('/me', token)
      .then((res) => {
        setProfile(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Errore caricamento profilo');
        setLoading(false);
      });
  }, [router]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const token = getAccessToken();

    if (token) {
      try {
        await apiPost<void>('/auth/logout', {}, { Authorization: `Bearer ${token}` });
      } catch (err) {
        // Decision 1A ADR-0012: error silente + log, always clearTokens anche su fail.
        // Sessione backend potrebbe restare orphan fino a scadenza naturale JWT (15 min).
        console.warn(
          'Logout server-side failed (session may remain orphan until JWT expiry):',
          err,
        );
      }
    }

    clearTokens();
    router.replace('/login');
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Caricamento...</p>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error ?? 'Profilo non disponibile'}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            Welcome {profile.user.firstName} {profile.user.lastName}
          </CardTitle>
          <CardDescription>{profile.user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <section>
            <h3 className="font-semibold mb-2">Ruoli</h3>
            <ul className="text-sm text-muted-foreground">
              {profile.roles.map((role) => (
                <li key={role.id}>• {role.name}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="font-semibold mb-2">Permessi ({profile.permissions.length})</h3>
            <div className="flex flex-wrap gap-1">
              {profile.permissions.map((perm) => (
                <span
                  key={perm}
                  className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded"
                >
                  {perm}
                </span>
              ))}
            </div>
          </section>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full"
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Uscita...' : 'Esci'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
