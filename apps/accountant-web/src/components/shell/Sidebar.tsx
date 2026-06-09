'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Receipt, Users, type LucideIcon } from 'lucide-react';

import { cn } from '@gestionale/ui';

// =============================================================================
// Sidebar.tsx — Primary nav shell (ADR-0018 DP-2)
// =============================================================================
// Desktop: fixed left 240px width, visible from `md` breakpoint up.
// Mobile: hidden default — wrapped in Sheet drawer triggered da Topbar
// hamburger (vedi Topbar.tsx + MainLayout.tsx).
//
// Skeleton verticale commercialisti (STOP-b2): nav ridotta a dashboard +
// clienti/fatture (placeholder "in arrivo"). Le route dominio reali arrivano
// con STOP-c. Active state via usePathname (match esatto su `/t/<slug>/<key>`).
// =============================================================================

interface NavItem {
  key: 'dashboard' | 'clienti' | 'fatture';
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ReadonlyArray<Omit<NavItem, 'href'>> = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'clienti', icon: Users },
  { key: 'fatture', icon: Receipt },
] as const;

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps): JSX.Element {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const t = useTranslations('shell.nav');
  const slug = params.slug;

  return (
    <nav
      className="flex h-full w-60 flex-col border-r bg-background"
      data-testid="sidebar"
      aria-label="Primary navigation"
    >
      <div className="px-6 py-5 border-b">
        <span className="text-lg font-semibold">Gestionale</span>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const href = `/t/${slug}/${item.key}`;
          // Prefix match: la voce resta attiva anche sui segmenti dinamici
          // figli (es. /clienti/[id] tiene "Clienti" attivo). Match esatto sul
          // top-level + startsWith su `${href}/` per le sub-route.
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
