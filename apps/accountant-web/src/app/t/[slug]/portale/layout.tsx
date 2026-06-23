import type { ReactNode } from 'react';

import { AuthGate } from '@gestionale/auth-web';
import { RequireTipo } from '@/components/shell/RequireTipo';
import { PortaleShell } from '@/components/portale/PortaleShell';

// =============================================================================
// portale/layout.tsx — superficie portale cliente (ADR-0046 §5)
// =============================================================================
// Sotto-albero `/t/[slug]/portale/...` nella stessa accountant-web (no app/
// subdomain separati). Gating in due strati:
//   - AuthGate: redirect a /login se non autenticato (come back-office).
//   - RequireTipo 'cliente': un operatore che capita qui viene rimandato alla
//     dashboard studio (la superficie giusta per il suo tipo).
// PortaleShell fornisce la shell cliente (header + logout), distinta dalla
// MainLayout studio.
//
// AuthProvider + NextIntlClientProvider sono già montati in [slug]/layout.tsx.
// =============================================================================

export default function PortaleLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthGate>
      <RequireTipo tipo="cliente" redirectPath="dashboard">
        <PortaleShell>{children}</PortaleShell>
      </RequireTipo>
    </AuthGate>
  );
}
