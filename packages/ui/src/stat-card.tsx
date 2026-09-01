'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from './card';

// =============================================================================
// stat-card.tsx — card KPI condivisa (PR0 del restyling, ADR-0083 amendment)
// =============================================================================
// Promossa da `apps/accountant-web/src/components/dashboard/StatCard.tsx`, dove
// viveva dal STOP-dash1 (ADR-0038). Il verticale food ne aveva un gemello
// ridotto (`KpiCard`, P2/PR3) nato locale di proposito: i due sono collassati
// qui in PR0, e il gemello e' poi sparito con il verticale.
//
// La promozione e' un SOVRAINSIEME preservato alla lettera, non un'armonia
// negoziata: la divergenza misurata era sottoinsieme/sovrainsieme puro (il
// gemello ridotto non aveva ne' breakdown ne' link, e non metteva la
// spaziatura verticale sul contenuto). Vinse il sovrainsieme, senza ritocchi.
// Oggi il call-site e' uno solo, ma la forma resta quella collassata: e'
// quello che rende la primitiva riusabile senza rinegoziarla.
//
// `space-y-2` sul contenuto agisce solo FRA figli adiacenti: un call-site che
// passa un figlio solo non lo tocca. E' il motivo per cui il sovrainsieme era
// adottabile da entrambi i gemelli senza diff visivo, e per cui resta neutro
// per qualunque call-site futuro.
//
// `tabular-nums` sul valore: senza, le cifre a larghezza variabile fanno
// "ballare" i numeri fra un refresh e l'altro in una riga di card affiancate.
//
// ⚠️ Questo file introduce il PRIMO import di Next in `@gestionale/ui` (`Link`).
// E' una scelta dichiarata, non una svista: vedi l'amendment di ADR-0083.
// Alternativa scartata: iniettare il link dal chiamante, che rimetterebbe
// markup nei call-site e riaprirebbe la porta alla divergenza che questa
// promozione esiste per chiudere. `next` e' peer + dev dependency del package.
//
// ⚠️ NIENTE nomi di utility di colore nei commenti di questo package: le app
// hanno `packages/ui/src/**` nel `content` di Tailwind, che estrae i candidati
// dal testo GREZZO del file — commenti inclusi (ADR-0085 §D5).
// =============================================================================

export interface StatCardProps {
  title: string;
  value: string | number;
  /** Breakdown/sottotitolo sotto il valore grande. */
  children?: ReactNode;
  /** Link opzionale in fondo alla card. */
  link?: { href: string; label: string };
}

export function StatCard({ title, value, children, link }: StatCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
        {link && (
          <Link
            href={link.href}
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
          >
            {link.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
