'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Globe, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react';

import { Avatar, AvatarFallback } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gestionale/ui';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@gestionale/ui';
import { locales, type Locale } from '@gestionale/i18n/config';
import { setLocale } from '@gestionale/i18n/client';
import { useAuth } from '@gestionale/auth-web';
import { brand } from '@/lib/brand';

import { Sidebar } from './Sidebar';

// =============================================================================
// Topbar.tsx — Header shell (ADR-0018 DP-2 + Sub-DP-A i18n switcher)
// =============================================================================
// Layout:
// - Sx mobile: hamburger Sheet trigger → drawer Sidebar
// - Sx desktop: wordmark del brand verticale (sidebar gia' visibile a sx)
// - Dx: user dropdown (Avatar trigger) con profilo + theme + locale + logout
//
// Theme toggle: next-themes useTheme(), 3 opzioni (light/dark/system).
// Locale switcher: POST /api/set-locale + router.refresh() (re-render RSC
// con nuove messages, no full reload).
// Logout: useAuth().logout() — pattern TD-6 preservato (NO reinvent).
// =============================================================================

function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.charAt(0) ?? '';
  const l = lastName?.charAt(0) ?? '';
  return (f + l).toUpperCase() || '?';
}

export function Topbar(): JSX.Element {
  const router = useRouter();
  const t = useTranslations('shell.topbar');
  const { user, tenant, roles, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const currentLocale = useLocale() as Locale;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleLogout = async (): Promise<void> => {
    await logout();
  };

  const handleSetLocale = (locale: Locale): void => {
    if (locale === currentLocale) return;
    startTransition(async () => {
      if (await setLocale(locale)) {
        router.refresh();
      }
    });
  };

  const initials = getInitials(user?.firstName, user?.lastName);
  const primaryRole = roles[0]?.name;

  return (
    <header
      className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6"
      data-testid="topbar"
    >
      <div className="flex items-center gap-3">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t('openMenu')}
              data-testid="sidebar-mobile-trigger"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-60">
            <SheetTitle className="sr-only">{t('openMenu')}</SheetTitle>
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <brand.Logo className="h-5 w-auto md:hidden" aria-label={brand.productName} />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t('userMenu')}
            data-testid="user-menu-trigger"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {user && (
            <>
              <DropdownMenuLabel className="font-normal">
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {tenant.slug}
                    {primaryRole ? ` · ${primaryRole}` : ''}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('theme.label')}
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setTheme('light')}
            aria-selected={theme === 'light'}
            data-testid="theme-light"
          >
            <Sun className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('theme.light')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme('dark')}
            aria-selected={theme === 'dark'}
            data-testid="theme-dark"
          >
            <Moon className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('theme.dark')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme('system')}
            aria-selected={theme === 'system'}
            data-testid="theme-system"
          >
            <Monitor className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('theme.system')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('language.label')}
          </DropdownMenuLabel>
          {locales.map((loc) => (
            <DropdownMenuItem
              key={loc}
              onClick={() => handleSetLocale(loc)}
              disabled={isPending}
              aria-selected={currentLocale === loc}
              data-testid={`locale-${loc}`}
            >
              <Globe className="mr-2 h-4 w-4" aria-hidden="true" />
              {t(`language.${loc}`)}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            data-testid="logout-button"
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
