'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';

import { ContoForm } from '@/components/comande/ContoForm';
import { Alert, AlertDescription } from '@gestionale/ui';
import { Button } from '@gestionale/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';
import { cn } from '@gestionale/ui';
import { messageForError } from '@/lib/error-codes';
import { createConto, listConti } from '@/lib/conti-api';
import type { Conto, CreateContoInput } from '@/lib/conti-types';

// =============================================================================
// comande/page.tsx — Lista conti aperti (PR-1, sostituisce il placeholder)
// =============================================================================
// Client component (pattern menu/page.tsx). Fetch client-side via conti-api,
// stato React locale, refetch on mutation (no react-query — confine progetto).
// Apertura conto inline (canali non-cassa). Gating UX su permessi comande.* —
// la sicurezza reale è backend (RBAC per rotta).
// =============================================================================

export default function ComandeListPage(): JSX.Element {
  const t = useTranslations('comande');
  const { tenant, permissions } = useAuth();
  const canView = permissions.includes('comande.visualizza');
  const canCreate = permissions.includes('comande.crea');

  const [conti, setConti] = useState<Conto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setConti(await listConti({ stato: 'aperto' }));
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
    else setIsLoading(false);
  }, [canView, load]);

  async function handleCreate(input: CreateContoInput): Promise<void> {
    await createConto(input);
    await load();
    setCreating(false);
  }

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Alert variant="destructive">
          <AlertDescription>{t('noAccess')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {canCreate &&
        (creating ? (
          <Card>
            <CardContent className="pt-6">
              <ContoForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('newConto')}
          </Button>
        ))}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : conti.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <ul className="space-y-3">
          {conti.map((conto) => (
            <li key={conto.id}>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{t(`channel.${conto.channel}`)}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {conto.tavoloId ? `${t('tavolo')} ${conto.tavoloId}` : t('noTavolo')}
                      {conto.coperti != null && ` · ${t('coperti')}: ${conto.coperti}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {t(`stato.${conto.stato}`)}
                  </span>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/t/${tenant.slug}/comande/${conto.id}`}>{t('open')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
