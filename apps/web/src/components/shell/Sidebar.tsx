'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  CreditCard,
  Grid3x3,
  LayoutDashboard,
  Settings,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

// =============================================================================
// Sidebar.tsx — Primary nav shell (ADR-0018 DP-2)
// =============================================================================
// Desktop: fixed left 240px width, visible from `md` breakpoint up.
// Mobile: hidden default — wrapped in Sheet drawer triggered da Topbar
// hamburger (vedi Topbar.tsx + MainLayout.tsx).
//
// Nav items placeholder (STOP 6 crea le pages):
// dashboard / menu / mappa / comande / cassa / kds / report / settings.
// Active state via usePathname + suffix match (es. `/t/demo/menu` matcha
// item con href ending in `/menu`).
// =============================================================================

interface NavItem {
  key: 'dashboard' | 'menu' | 'mappa' | 'comande' | 'cassa' | 'kds' | 'report' | 'settings';
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ReadonlyArray<Omit<NavItem, 'href'>> = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'menu', icon: UtensilsCrossed },
  { key: 'mappa', icon: Grid3x3 },
  { key: 'comande', icon: ClipboardList },
  { key: 'cassa', icon: CreditCard },
  { key: 'kds', icon: ChefHat },
  { key: 'report', icon: BarChart3 },
  { key: 'settings', icon: Settings },
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
          const isActive = pathname === href;
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
