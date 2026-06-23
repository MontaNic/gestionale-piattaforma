'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { Button } from '@gestionale/ui';
import { cn } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

// =============================================================================
// PortaleShell.tsx — shell minimale del portale cliente (ADR-0046 §5)
// =============================================================================
// Superficie cliente, separata dalla shell studio (Sidebar/Topbar back-office).
// Header con identità + logout + nav (le voci compaiono man mano che arrivano le
// pagine: Documenti read-only è la prima, ADR-0046). Active-state via usePathname
// (match esatto su `/t/<slug>/portale[/<key>]`, pattern Sidebar studio).
// Stringhe in italiano (superficie portale single-locale).
// =============================================================================

const NAV: ReadonlyArray<{ key: string; label: string }> = [
  { key: '', label: 'Home' },
  { key: 'documenti', label: 'Documenti' },
];

export function PortaleShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, logout } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const base = `/t/${slug}/portale`;

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6"
        data-testid="portale-topbar"
      >
        <div className="flex items-center gap-6">
          <span className="text-base font-semibold">Portale Cliente</span>
          <nav className="flex items-center gap-1" aria-label="Portale">
            {NAV.map((item) => {
              const href = item.key ? `${base}/${item.key}` : base;
              const active = pathname === href;
              return (
                <Link
                  key={item.key || 'home'}
                  href={href}
                  className={cn(
                    'rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.firstName} {user.lastName}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            data-testid="portale-logout-button"
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Esci
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto bg-muted/30 p-4 md:p-6">{children}</main>
    </div>
  );
}
