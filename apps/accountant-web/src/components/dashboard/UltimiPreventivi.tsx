'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle, cn } from '@gestionale/ui';
import type { StatoPreventivo } from '@/lib/preventivi-types';
import type { UltimoPreventivo } from '@/lib/dashboard-types';

// =============================================================================
// UltimiPreventivi.tsx — Widget 5 preventivi più recenti (STOP-dash1 ADR-0038)
// =============================================================================
// Tabella HTML grezza (no Table primitive). Stato badge = markup + classi.
// Le etichette stato riusano il namespace i18n `preventivi.stato.*` (stesso
// dominio). Riga cliccabile → editor preventivo (route STOP-e2).
// =============================================================================

const STATO_BADGE: Record<StatoPreventivo, string> = {
  bozza: 'bg-muted text-muted-foreground',
  inviato: 'bg-secondary text-secondary-foreground',
  accettato: 'bg-secondary text-secondary-foreground',
  rifiutato: 'bg-muted text-muted-foreground',
  convertito: 'bg-blue-100 text-blue-800',
};

interface UltimiPreventiviProps {
  items: UltimoPreventivo[];
  slug: string;
}

export function UltimiPreventivi({ items, slug }: UltimiPreventiviProps): JSX.Element {
  const t = useTranslations('dashboard');
  const tp = useTranslations('preventivi');
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('ultimi.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('ultimi.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('ultimi.col.codice')}</th>
                  <th className="px-3 py-2 font-medium">{t('ultimi.col.oggetto')}</th>
                  <th className="px-3 py-2 font-medium">{t('ultimi.col.cliente')}</th>
                  <th className="px-3 py-2 font-medium">{t('ultimi.col.stato')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('ultimi.col.totale')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                    onClick={() =>
                      router.push(`/t/${slug}/clienti/${p.aziendaId}/preventivi/${p.id}`)
                    }
                  >
                    <td className="px-3 py-2 font-medium">{p.codice}</td>
                    <td className="px-3 py-2">{p.oggetto}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.aziendaNome}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATO_BADGE[p.stato],
                        )}
                      >
                        {tp(`stato.${p.stato}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">€ {p.totale.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
