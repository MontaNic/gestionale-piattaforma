'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { NotaSpesa } from '@/lib/note-spese-types';
import { giorniDelMese, offsetPrimoGiorno, oggiLocale } from '@/lib/note-spese-date';

// =============================================================================
// CalendarioMese — griglia mensile con totale per giorno (§8)
// =============================================================================
// Nessun componente calendario esisteva nel repo: costruito qui da zero, senza
// dipendenze date esterne (Intl per i nomi, aritmetica UTC per evitare drift di
// fuso — `data` è già date-only YYYY-MM-DD).
//
// Settimana lunedì-first (locale IT). Un giorno SENZA note è visivamente distinto
// da un giorno con note che totalizzano zero (§8): il primo non mostra importo.
// Click sul giorno = selezione (DP-1), non apertura del form.
// =============================================================================

interface Props {
  /** Mese corrente in formato YYYY-MM. */
  mese: string;
  note: NotaSpesa[];
  giornoSelezionato: string | null;
  onSelectGiorno: (giorno: string) => void;
  currencyFmt: Intl.NumberFormat;
}

interface Cella {
  giorno: string; // YYYY-MM-DD
  numero: number;
  totale: number;
  count: number;
}

export function CalendarioMese({
  mese,
  note,
  giornoSelezionato,
  onSelectGiorno,
  currencyFmt,
}: Props): JSX.Element {
  const locale = useLocale();
  const t = useTranslations('noteSpese');

  const anno = Number(mese.slice(0, 4));
  const mese1based = Number(mese.slice(5, 7));

  // Nomi giorni settimana (lun→dom) dal locale attivo.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2024-01-01 è un lunedì: base stabile per estrarre i 7 nomi in ordine.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);

  const celle = useMemo<Cella[]>(() => {
    const perGiorno = new Map<string, { totale: number; count: number }>();
    for (const n of note) {
      const acc = perGiorno.get(n.data) ?? { totale: 0, count: 0 };
      acc.totale += n.totale;
      acc.count += 1;
      perGiorno.set(n.data, acc);
    }
    const totGiorni = giorniDelMese(anno, mese1based);
    return Array.from({ length: totGiorni }, (_, i) => {
      const numero = i + 1;
      const giorno = `${mese}-${String(numero).padStart(2, '0')}`;
      const acc = perGiorno.get(giorno);
      return { giorno, numero, totale: acc?.totale ?? 0, count: acc?.count ?? 0 };
    });
  }, [note, anno, mese1based, mese]);

  const offset = offsetPrimoGiorno(anno, mese1based);
  const oggi = oggiLocale();

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {weekdays.map((w) => (
          <div
            key={w}
            className="px-1 py-1 text-center text-xs font-medium uppercase text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden="true" />
        ))}
        {celle.map((c) => {
          const isSelected = c.giorno === giornoSelezionato;
          const isToday = c.giorno === oggi;
          const haNote = c.count > 0;
          return (
            <button
              key={c.giorno}
              type="button"
              onClick={() => onSelectGiorno(c.giorno)}
              aria-pressed={isSelected}
              aria-label={t('giornoAria', { giorno: c.numero, count: c.count })}
              className={[
                'flex min-h-[3.75rem] flex-col items-start rounded-md border px-1.5 py-1 text-left transition-colors',
                isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-border hover:bg-muted/50',
                // Giorno senza note: superficie attenuata (distinto da un totale a zero).
                haNote ? 'bg-background' : 'bg-muted/20',
              ].join(' ')}
            >
              <span
                className={[
                  'text-xs',
                  isToday ? 'font-bold text-foreground' : 'text-muted-foreground',
                ].join(' ')}
              >
                {c.numero}
              </span>
              {haNote && (
                <>
                  <span className="mt-auto w-full truncate text-xs font-semibold tabular-nums">
                    {currencyFmt.format(c.totale)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('noteCount', { count: c.count })}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
