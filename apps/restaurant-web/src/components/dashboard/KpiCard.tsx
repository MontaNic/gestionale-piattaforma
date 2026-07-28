'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@gestionale/ui';

// =============================================================================
// KpiCard.tsx — card di un singolo KPI (P2/PR3)
// =============================================================================
// LOCALE a restaurant-web di proposito (DP7): esiste già un `StatCard` in
// accountant-web, ma promuoverlo a `packages/ui` è lavoro di P3 — farlo qui
// significherebbe toccare il design system in una PR che deve restare per-app
// e a blast radius zero. Quando la promozione arriverà, questo file e quello
// accountant collassano in una primitiva sola.
//
// Solo primitive `Card` dal barrel + token: nessun letterale (legge #1),
// nessun valore dell'estetica A (che è P3, uniforme su tutte le pagine).
//
// `tabular-nums` sul valore: senza, le cifre a larghezza variabile fanno
// "ballare" i numeri fra un refresh e l'altro in una riga di card affiancate.
// =============================================================================

interface KpiCardProps {
  label: string;
  value: string;
}

export function KpiCard({ label, value }: KpiCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
