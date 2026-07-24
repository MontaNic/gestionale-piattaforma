'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import type { NotaSpesa } from '@/lib/note-spese-types';
import { NotaSpesaRow } from './NotaSpesaRow';

// =============================================================================
// ElencoNote — elenco raggruppato per data, ordine decrescente (§2/§8)
// =============================================================================
// Alternativa al calendario nel toggle di vista. Il totale per gruppo dà lo
// stesso colpo d'occhio della cella calendario.
// =============================================================================

interface Props {
  note: NotaSpesa[];
  currencyFmt: Intl.NumberFormat;
  dateFmt: Intl.DateTimeFormat;
  aziendaNomeById: Map<string, string>;
  mandatoCodiceById: Map<string, string>;
  onSelectNota?: (nota: NotaSpesa) => void;
}

export function ElencoNote({
  note,
  currencyFmt,
  dateFmt,
  aziendaNomeById,
  mandatoCodiceById,
  onSelectNota,
}: Props): JSX.Element {
  const t = useTranslations('noteSpese');

  const gruppi = useMemo(() => {
    const m = new Map<string, NotaSpesa[]>();
    for (const n of note) {
      const arr = m.get(n.data);
      if (arr) arr.push(n);
      else m.set(n.data, [n]);
    }
    // Data decrescente (§2).
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [note]);

  return (
    <div className="space-y-4">
      {gruppi.map(([giorno, items]) => {
        const totale = items.reduce((s, n) => s + n.totale, 0);
        return (
          <div key={giorno} className="overflow-hidden rounded-md border">
            <div className="flex items-baseline justify-between gap-3 border-b bg-muted/30 px-3 py-2">
              <span className="text-sm font-semibold">
                {dateFmt.format(new Date(`${giorno}T00:00:00Z`))}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t('totaleGiorno')} <strong>{currencyFmt.format(totale)}</strong>
              </span>
            </div>
            <ul className="divide-y">
              {items.map((n) => (
                <NotaSpesaRow
                  key={n.id}
                  nota={n}
                  currencyFmt={currencyFmt}
                  aziendaNome={n.aziendaId ? aziendaNomeById.get(n.aziendaId) : undefined}
                  mandatoCodice={n.mandatoId ? mandatoCodiceById.get(n.mandatoId) : undefined}
                  onClick={onSelectNota ? () => onSelectNota(n) : undefined}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
