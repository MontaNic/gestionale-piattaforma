import type { ReactNode } from 'react';

import { AuthGate } from '@gestionale/auth-web';
import { MainLayout } from '@/components/shell/MainLayout';
import { RequireTipo } from '@/components/shell/RequireTipo';

// =============================================================================
// (authenticated)/layout.tsx — Shell wrap per route protette (ADR-0018 Sub-DP-D)
// =============================================================================
// Route group `(authenticated)` non si manifesta in URL — separa solo le
// rotte autenticate dalla login pubblica. Tutte le pages sotto questo
// layout ereditano AuthGate (redirect login se !isAuthenticated) +
// RequireTipo 'operatore' (ADR-0046 §4: un cliente che capita nel back-office
// viene rimandato al portale) + MainLayout (Sidebar + Topbar + main area).
//
// AuthProvider e NextIntlClientProvider sono gia' montati a livello
// `[slug]/layout.tsx` (parent server component) → useAuth + useTranslations
// disponibili in tutta la sub-tree.
// =============================================================================

export default function AuthenticatedLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthGate>
      <RequireTipo tipo="operatore" redirectPath="portale">
        <MainLayout>{children}</MainLayout>
      </RequireTipo>
    </AuthGate>
  );
}
