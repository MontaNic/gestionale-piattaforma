import type { ReactNode } from 'react';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

// =============================================================================
// MainLayout.tsx — Compose Sidebar + Topbar + main (ADR-0018 DP-2)
// =============================================================================
// Responsive: mobile sidebar hidden (Sheet drawer in Topbar), desktop sidebar
// fixed left. `min-h-screen` su outer flex per garantire full-height anche
// con poco contenuto. Main content area `flex-1` per riempire spazio residuo.
// =============================================================================

export function MainLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:block">
        <Sidebar />
      </aside>
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
