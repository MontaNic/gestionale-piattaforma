'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth, type UserTipo } from '@gestionale/auth-web';

// =============================================================================
// RequireTipo — role-gate per separare back-office studio e portale cliente
// =============================================================================
// ADR-0046 §4: login unico, due superfici nella stessa app. AuthGate garantisce
// l'autenticazione; questo gate garantisce che l'utente sia sulla superficie
// giusta per il suo `tipo`. Se non lo è, redirige (defense-in-depth: i dati sono
// comunque protetti lato API dai permessi, ma evita di mostrare la shell errata).
//
// Va montato DENTRO un AuthGate (assume isAuthenticated=true a regime); finché
// `isLoading` mostra il fallback per evitare flash della superficie sbagliata.
// =============================================================================

export function RequireTipo({
  tipo,
  redirectPath,
  children,
}: {
  tipo: UserTipo;
  /** Dove mandare l'utente il cui `tipo` non corrisponde (relativo, senza slug). */
  redirectPath: string;
  children: ReactNode;
}): JSX.Element | null {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, tenant } = useAuth();

  const mismatched = isAuthenticated && user !== null && user.tipo !== tipo;

  useEffect(() => {
    if (!isLoading && mismatched) {
      router.replace(`/t/${tenant.slug}/${redirectPath}`);
    }
  }, [isLoading, mismatched, router, tenant.slug, redirectPath]);

  if (isLoading) {
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        data-testid="require-tipo-loading"
      >
        <p className="text-muted-foreground">Caricamento...</p>
      </main>
    );
  }

  // Redirect in flight (tipo errato) → render null per evitare flash della shell.
  if (mismatched) return null;

  return <>{children}</>;
}
