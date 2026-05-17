'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';

// =============================================================================
// AuthGate — client guard redirect login (ADR-0018 §AuthGate)
// =============================================================================
// Responsabilita': dato lo stato di AuthContext, redirige a `/t/<slug>/login`
// se non autenticato. Mostra fallback spinner durante isLoading per evitare
// flash unauthorized content.
//
// TD-BA migration path: quando TD-1 httpOnly cookie sara' risolto, questo
// guard sara' spostato a Next.js middleware server-side (NO flash possibile,
// 302 prima del render). Per ora client-side e' coerente con localStorage
// token reader (token NON server-readable).
// =============================================================================

export function AuthGate({ children }: { children: ReactNode }): JSX.Element | null {
  const router = useRouter();
  const { isAuthenticated, isLoading, tenant } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/t/${tenant.slug}/login`);
    }
  }, [isLoading, isAuthenticated, router, tenant.slug]);

  if (isLoading) {
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        data-testid="auth-gate-loading"
      >
        <p className="text-muted-foreground">Caricamento...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    // Redirect in flight — render null per evitare flash di contenuto protetto.
    return null;
  }

  return <>{children}</>;
}
