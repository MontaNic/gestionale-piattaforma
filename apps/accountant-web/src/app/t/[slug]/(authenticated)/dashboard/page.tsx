'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';

import { Alert, AlertDescription, Button, StatCard } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { UltimiPreventivi } from '@/components/dashboard/UltimiPreventivi';
import { getDashboardStats } from '@/lib/dashboard-api';
import { getScadenze } from '@/lib/scadenze-api';
import { messageForError } from '@/lib/error-codes';
import type { DashboardStats } from '@/lib/dashboard-types';
import type { Scadenza } from '@/lib/scadenze-types';

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
  const canViewScadenze = permissions.includes('scadenze.visualizza');

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const oggi = new Date();
      const fra7 = new Date(oggi);
      fra7.setDate(oggi.getDate() + 7);
      const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

      const [statsRes, scadenzeRes] = await Promise.allSettled([
        canView ? getDashboardStats() : Promise.resolve(null),
        canViewScadenze
          ? getScadenze({ attivo: true, da: toDateOnly(oggi), a: toDateOnly(fra7) })
          : Promise.resolve([]),
      ]);

      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      else setLoadError(messageForError(statsRes.reason));

      if (scadenzeRes.status === 'fulfilled') setScadenze(scadenzeRes.value);
    } finally {
      setIsLoading(false);
    }
  }, [canView, canViewScadenze]);

  useEffect(() => {
    if (canView || canViewScadenze) void load();
  }, [canView, canViewScadenze, load]);

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

      {canViewScadenze && !isLoading && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Scadenze imminenti (prossimi 7 giorni)
          </h2>
          {scadenze.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna scadenza nei prossimi 7 giorni.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <ul className="divide-y">
                {scadenze.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/t/${slug}/scadenze`}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="flex-1 font-medium">{s.titolo}</span>
                      <span className="text-xs text-muted-foreground">{s.dataScadenza}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
