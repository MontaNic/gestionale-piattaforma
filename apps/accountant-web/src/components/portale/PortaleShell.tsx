'use client';

import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

// =============================================================================
// PortaleShell.tsx — shell minimale del portale cliente (ADR-0046 §5)
// =============================================================================
// Superficie cliente, separata dalla shell studio (Sidebar/Topbar back-office).
// Task 1 (fondamenta): header con identità + logout, area contenuti. La
// navigazione cliente (documenti, comunicazioni, circolari) arriva coi task
// successivi quando ci saranno le pagine da linkare.
// =============================================================================

export function PortaleShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6"
        data-testid="portale-topbar"
      >
        <span className="text-base font-semibold">Portale Cliente</span>
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
