'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, Button } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { StatCard } from '@/components/dashboard/StatCard';
import { UltimiPreventivi } from '@/components/dashboard/UltimiPreventivi';
import { getDashboardStats } from '@/lib/dashboard-api';
import { messageForError } from '@/lib/error-codes';
import type { DashboardStats } from '@/lib/dashboard-types';

// =============================================================================
// dashboard/page.tsx — Home operatore-studio: card-grid KPI (STOP-dash1 ADR-0038)
// =============================================================================
// Da welcome statica → dashboard con KPI clienti + preventivi + ultimi preventivi,
// alimentata da GET /dashboard/stats. Client component, useState + fetch on-mount
// (no react-query, convenzione accountant-web). Gating: senza
// `anagrafica.cliente.visualizza` mostra messaggio invece dei KPI (l'endpoint
// risponderebbe 403). Welcome col nome utente mantenuto come intestazione home.
// =============================================================================

export default function DashboardPage(): JSX.Element {
  const t = useTranslations('dashboard');
  const tp = useTranslations('preventivi');
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const { user, permissions } = useAuth();
  const canView = permissions.includes('anagrafica.cliente.visualizza');

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setStats(await getDashboardStats());
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {user
            ? t('welcome', { firstName: user.firstName, lastName: user.lastName })
            : t('subtitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {!canView ? (
        <Alert>
          <AlertDescription>{t('insufficientPermissions')}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : loadError || !stats ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError ?? t('loadError')}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              title={t('clienti.title')}
              value={stats.clienti.totale}
              link={{ href: `/t/${slug}/clienti`, label: t('clienti.vediTutti') }}
            >
              {/* Taglio stato */}
              <span className="block">
                {stats.clienti.attivi} {t('clienti.attivi')} · {stats.clienti.nonAttivi}{' '}
                {t('clienti.nonAttivi')}
              </span>
              {/* Taglio tipo (dimensione ortogonale) */}
              <span className="mt-1 block">
                {stats.clienti.perTipo.azienda} {t('clienti.aziende')} ·{' '}
                {stats.clienti.perTipo.personaFisica} {t('clienti.personeFisiche')}
              </span>
            </StatCard>

            <StatCard title={t('preventivi.title')} value={stats.preventivi.totale}>
              <span className="block">
                {t('preventivi.valoreTotale')}:{' '}
                <span className="font-medium text-foreground">
                  € {stats.preventivi.valoreTotale.toFixed(2)}
                </span>
              </span>
              <span className="mt-1 block">
                {tp('stato.bozza')}: {stats.preventivi.perStato.bozza} · {tp('stato.inviato')}:{' '}
                {stats.preventivi.perStato.inviato} · {tp('stato.accettato')}:{' '}
                {stats.preventivi.perStato.accettato} · {tp('stato.rifiutato')}:{' '}
                {stats.preventivi.perStato.rifiutato}
              </span>
            </StatCard>
          </div>

          <UltimiPreventivi items={stats.preventivi.ultimi} slug={slug} />
        </>
      )}
    </div>
  );
}
