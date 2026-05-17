'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// =============================================================================
// PlaceholderPage.tsx — Shared "Coming soon" page (ADR-0018 STOP 6)
// =============================================================================
// Pattern: ogni placeholder route F1 (menu/mappa/comande/cassa/kds/report/
// settings) e' una page.tsx 1-line che istanzia <PlaceholderPage section="..."/>
// con la chiave i18n del namespace `placeholder.<section>`.
//
// Razionale shared component vs 7 file duplicati: zero copy-paste drift,
// modifica futura (es. aggiungere badge / icona / link doc) propaga
// automatica a tutti i placeholder.
// =============================================================================

type PlaceholderSection = 'menu' | 'mappa' | 'comande' | 'cassa' | 'kds' | 'report' | 'settings';

export function PlaceholderPage({ section }: { section: PlaceholderSection }): JSX.Element {
  const t = useTranslations('placeholder');
  return (
    <Card className="w-full max-w-2xl" data-testid={`placeholder-${section}`}>
      <CardHeader>
        <CardTitle>{t(`${section}.title`)}</CardTitle>
        <CardDescription>{t('comingSoon')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t(`${section}.desc`)}</p>
      </CardContent>
    </Card>
  );
}
