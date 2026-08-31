'use client';

import { useTranslations } from 'next-intl';
import { Paperclip, TriangleAlert } from 'lucide-react';

import type { NotaSpesa, StatoNotaSpesa } from '@/lib/note-spese-types';
import { allegatiMancanti } from '@/lib/note-spese-types';

// =============================================================================
// NotaSpesaRow — riga sintetica di una nota spese (elenco + dettaglio giorno)
// =============================================================================
// Mostra tipo, importo, stato, presenza allegati e azienda/mandato se valorizzati.
// Il badge "allegato mancante" (§8) è NON bloccante: anticipa il rifiuto di
// `invia` (§4.1/§4.2) senza impedire nulla. Le label enum passano da i18n.
// =============================================================================

const STATO_CLASS: Record<StatoNotaSpesa, string> = {
  bozza: 'bg-muted text-muted-foreground',
  inviata: 'bg-info-soft text-info',
  approvata: 'bg-success-soft text-success',
  respinta: 'bg-destructive/10 text-destructive',
};

interface Props {
  nota: NotaSpesa;
  currencyFmt: Intl.NumberFormat;
  aziendaNome?: string;
  mandatoCodice?: string;
  onClick?: () => void;
}

export function NotaSpesaRow({
  nota,
  currencyFmt,
  aziendaNome,
  mandatoCodice,
  onClick,
}: Props): JSX.Element {
  const t = useTranslations('noteSpese');
  const mancanti = allegatiMancanti(nota);

  const content = (
    <>
      <span className="font-medium">{t(`tipoSpesa.${nota.tipoSpesa}`)}</span>
      <span className="tabular-nums font-semibold">{currencyFmt.format(nota.totale)}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${STATO_CLASS[nota.stato]}`}>
        {t(`stato.${nota.stato}`)}
      </span>
      {aziendaNome && <span className="text-xs text-muted-foreground">{aziendaNome}</span>}
      {mandatoCodice && (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {mandatoCodice}
        </span>
      )}
      {nota.allegati.length > 0 && (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title={t('allegatiPresenti', { count: nota.allegati.length })}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          {nota.allegati.length}
        </span>
      )}
      {mancanti.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-warn">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {mancanti.map((m) => t(`tipoAllegato.${m}`)).join(', ')}
        </span>
      )}
      <span className="ml-auto max-w-[16rem] truncate text-xs text-muted-foreground">
        {nota.scopoMissione}
      </span>
    </>
  );

  const className = 'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm';

  if (!onClick) return <li className={className}>{content}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`${className} w-full text-left hover:bg-muted/50`}
      >
        {content}
      </button>
    </li>
  );
}
