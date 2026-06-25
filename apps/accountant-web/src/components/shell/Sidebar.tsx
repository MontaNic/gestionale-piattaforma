'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  Building2,
  CalendarDays,
  FileSignature,
  FileText,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Receipt,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@gestionale/ui';
import { PLATFORM_SLUG } from '@/lib/platform-types';

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
  key:
    | 'dashboard'
    | 'clienti'
    | 'scadenze'
    | 'catalogo'
    | 'mandati'
    | 'comunicazioni'
    | 'documenti'
    | 'circolari'
    | 'fatture'
    | 'margine'
    | 'platform';
  // Segmento dopo /t/<slug>/ (default = key). Override per route annidate.
  path?: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ReadonlyArray<Omit<NavItem, 'href'>> = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'clienti', icon: Users },
  { key: 'scadenze', icon: CalendarDays },
  { key: 'catalogo', icon: BookOpen },
  { key: 'mandati', icon: FileSignature },
  { key: 'comunicazioni', icon: MessageSquare },
  { key: 'documenti', icon: FileText },
  { key: 'circolari', icon: Megaphone },
  { key: 'fatture', icon: Receipt },
] as const;

// Voce superadmin: mostrata SOLO nel tenant di piattaforma `oneplatform`.
const PLATFORM_NAV_ITEM: Omit<NavItem, 'href'> = {
  key: 'platform',
  path: 'platform/tenants',
  icon: Building2,
};

// Gruppo "Report" (ADR-0054): viste analitiche separate dalla nav operativa.
const REPORT_NAV_ITEMS: ReadonlyArray<Omit<NavItem, 'href'>> = [
  { key: 'margine', path: 'report/margine', icon: TrendingUp },
] as const;

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps): JSX.Element {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const t = useTranslations('shell.nav');
  const tg = useTranslations('shell.navGroups');
  const slug = params.slug;

  // La voce Piattaforma compare solo nel tenant oneplatform (gating UX; il BE
  // rinforza con PlatformGuard).
  const items = slug === PLATFORM_SLUG ? [...NAV_ITEMS, PLATFORM_NAV_ITEM] : NAV_ITEMS;

  function renderItem(item: Omit<NavItem, 'href'>): JSX.Element {
    const href = `/t/${slug}/${item.path ?? item.key}`;
    // Prefix match: la voce resta attiva anche sui segmenti dinamici figli.
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
              ? 'bg-blue-100 text-blue-900 font-semibold dark:bg-blue-900/30 dark:text-blue-100'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t(item.key)}</span>
        </Link>
      </li>
    );
  }

  return (
    <nav
      className="flex h-full w-60 flex-col border-r border-border bg-background"
      data-testid="sidebar"
      aria-label="Primary navigation"
    >
      <div className="px-6 py-5 border-b">
        <span className="text-lg font-semibold">Gestionale</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">{items.map(renderItem)}</ul>

        {/* Gruppo Report (ADR-0054) */}
        <p className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tg('report')}
        </p>
        <ul className="space-y-1">{REPORT_NAV_ITEMS.map(renderItem)}</ul>
      </div>
    </nav>
  );
}
