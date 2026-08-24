'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, CreditCard, Grid3x3, Plus } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
} from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { listConti } from '@/lib/conti-api';
import type { Conto, StatoConto } from '@/lib/conti-types';
import { getDashboardStats } from '@/lib/dashboard-api';
import type { DashboardStats } from '@/lib/dashboard-types';
import { messageForError } from '@/lib/error-codes';
import { formatEuro } from '@/lib/format';
import { listTables } from '@/lib/table-api';

// =============================================================================
// dashboard/page.tsx — Home operatore di sala (P2/PR3, ADR-0084 + ADR-0085)
// =============================================================================
// Da welcome statica (nome + dump dei permessi come chip) a landing con dati
// reali. È la pagina su cui atterrano TUTTI i ruoli dopo il login, e questo
// detta la sua struttura: sezioni indipendenti, ciascuna dietro il proprio
// permesso.
//
// ⚠️ GATE PRIMA DEL FETCH, non try/catch attorno. Il gate non è difensivo: è
// ciò che impedisce alla pagina di EMETTERE una response 403. Il tour e2e
// (`page-tour.spec.ts`) fallisce su qualunque response ≥400 sullo stesso host,
// a prescindere da come il JS la gestisca — quindi assorbire il 403 in un catch
// non basterebbe. Vale anche per il fetch dei tavoli, qui gated su
// `tavoli.visualizza` mentre in `cassa/page.tsx` è in try/catch: là la
// differenza non emerge perché il tour gira come Super Admin.
//
// Nessun polling: è una landing, non uno schermo operativo live. Il refresh sta
// nel bottone di retry e nel rientro sulla pagina. Un aggiornamento continuo,
// se servirà, sarà un TD a sé — non un `setInterval` messo qui per scrupolo.
//
// `Badge` (ADR-0085) trova qui la sua prima cliente reale. I due call-site
// duplicati in comande/cassa NON si toccano in questa PR: l'adozione ovunque
// è P3.
//
// Estetica: token attuali. Nessun valore dell'estetica A hardcodato — A arriva
// in P3, uniforme su tutte le pagine restaurant.
// =============================================================================

/** Stato conto → variant del Badge. Record totale: aggiungere uno stato al
 *  dominio rompe qui il typecheck invece di produrre una pastiglia muta.
 *  ⚠️ `statoPagamento` NON è mappabile oggi: non è sul payload flat di
 *  `GET /conti` (vive solo in `GET /conti/:id`) — è `TD-conti-list-amounts`.
 *  Quando quel TD chiude, la sua mappa si affianca a questa. */
const STATO_VARIANT: Record<StatoConto, NonNullable<BadgeProps['variant']>> = {
  aperto: 'info',
  chiuso: 'success',
  annullato: 'secondary',
};

/** Fascia oraria del saluto. Confini scelti sul servizio, non sull'orologio:
 *  il pomeriggio finisce alle 18 perché è lì che comincia la cena. */
function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 13) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function DashboardPage(): JSX.Element {
  const t = useTranslations('dashboard');
  const tc = useTranslations('comande');
  const locale = useLocale();
  const { user, tenant, permissions, error } = useAuth();

  const canViewStats = permissions.includes('report.operativo.visualizza');
  const canViewConti = permissions.includes('comande.visualizza');
  const canViewTavoli = permissions.includes('tavoli.visualizza');
  const canCreateConto = permissions.includes('comande.crea');
  const canViewCassa = permissions.includes('cassa.visualizza');

  // `now` fissato una volta: saluto e data non devono cambiare a ogni re-render.
  // Il componente non renderizza mai lato server (AuthGate mostra lo spinner
  // finché `/me` non risponde), quindi nessun mismatch di idratazione.
  const [now] = useState(() => new Date());

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(canViewStats);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [conti, setConti] = useState<Conto[]>([]);
  const [tavoliById, setTavoliById] = useState<Map<string, string>>(new Map());
  const [contiLoading, setContiLoading] = useState(canViewConti);
  const [contiError, setContiError] = useState<string | null>(null);

  const loadStats = useCallback(async (): Promise<void> => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      setStats(await getDashboardStats());
    } catch (err) {
      setStatsError(messageForError(err));
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadConti = useCallback(async (): Promise<void> => {
    setContiLoading(true);
    setContiError(null);
    try {
      setConti(await listConti({ stato: 'aperto' }));
      // Gated, non in try/catch: senza `tavoli.visualizza` la chiamata NON parte
      // (vedi nota in testa). Il numero tavolo resta ignoto e la riga lo omette.
      if (canViewTavoli) {
        const tavoli = await listTables();
        setTavoliById(new Map(tavoli.map((tv) => [tv.id, tv.numero])));
      }
    } catch (err) {
      setContiError(messageForError(err));
    } finally {
      setContiLoading(false);
    }
  }, [canViewTavoli]);

  useEffect(() => {
    if (canViewStats) void loadStats();
  }, [canViewStats, loadStats]);

  useEffect(() => {
    if (canViewConti) void loadConti();
  }, [canViewConti, loadConti]);

  if (error || !user) {
    return (
      <Alert variant="destructive" className="max-w-md">
        <AlertDescription>{error ?? t('profileUnavailable')}</AlertDescription>
      </Alert>
    );
  }

  const dateLabel = capitalize(
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now),
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8" data-testid="dashboard">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {t(`greeting.${greetingKey(now.getHours())}`, { name: user.firstName })}
        </h1>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
      </header>

      {canViewStats && (
        <section className="space-y-3" aria-labelledby="dashboard-kpi-title">
          <h2 id="dashboard-kpi-title" className="text-sm font-medium text-muted-foreground">
            {t('kpiTitle')}
          </h2>

          {statsError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{statsError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadStats()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : statsLoading || !stats ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-kpi">
              <StatCard title={t('kpi.contiAperti')} value={String(stats.contiAperti)} />
              <StatCard title={t('kpi.incassoOggi')} value={formatEuro(stats.incassoOggi)} />
              <StatCard title={t('kpi.copertiOggi')} value={String(stats.copertiOggi)} />
              <StatCard title={t('kpi.comandeInCorso')} value={String(stats.comandeInCorso)} />
            </div>
          )}
        </section>
      )}

      {canViewConti && (
        <section className="space-y-3" aria-labelledby="dashboard-conti-title">
          <h2 id="dashboard-conti-title" className="text-sm font-medium text-muted-foreground">
            {t('contiTitle')}
          </h2>

          {contiError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{contiError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadConti()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : contiLoading ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : conti.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contiEmpty')}</p>
          ) : (
            <ul className="space-y-3" data-testid="dashboard-conti">
              {conti.map((conto) => (
                <li key={conto.id}>
                  <Card>
                    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{tc(`channel.${conto.channel}`)}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {conto.tavoloId
                            ? `${tc('tavolo')} ${tavoliById.get(conto.tavoloId) ?? '—'}`
                            : tc('noTavolo')}
                          {conto.coperti != null && ` · ${tc('coperti')}: ${conto.coperti}`}
                        </p>
                      </div>
                      <Badge variant={STATO_VARIANT[conto.stato]} className="shrink-0">
                        {tc(`stato.${conto.stato}`)}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/t/${tenant.slug}/${canViewCassa ? 'cassa' : 'comande'}/${conto.id}`}
                        >
                          {t('contiOpen')}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(canCreateConto || canViewCassa || canViewTavoli || canViewConti) && (
        <section className="space-y-3" aria-labelledby="dashboard-actions-title">
          <h2 id="dashboard-actions-title" className="text-sm font-medium text-muted-foreground">
            {t('actionsTitle')}
          </h2>
          <div className="flex flex-wrap gap-3" data-testid="dashboard-actions">
            {canCreateConto ? (
              <Button asChild variant="outline">
                <Link href={`/t/${tenant.slug}/comande`}>
                  <Plus className="h-4 w-4" />
                  {t('actions.nuovoConto')}
                </Link>
              </Button>
            ) : (
              canViewConti && (
                <Button asChild variant="outline">
                  <Link href={`/t/${tenant.slug}/comande`}>
                    <ClipboardList className="h-4 w-4" />
                    {t('actions.comande')}
                  </Link>
                </Button>
              )
            )}
            {canViewCassa && (
              <Button asChild variant="outline">
                <Link href={`/t/${tenant.slug}/cassa`}>
                  <CreditCard className="h-4 w-4" />
                  {t('actions.cassa')}
                </Link>
              </Button>
            )}
            {canViewTavoli && (
              <Button asChild variant="outline">
                <Link href={`/t/${tenant.slug}/mappa`}>
                  <Grid3x3 className="h-4 w-4" />
                  {t('actions.mappa')}
                </Link>
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
