'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@gestionale/ui';

// =============================================================================
// StatCard.tsx — Card KPI riusabile (STOP-dash1 ADR-0038)
// =============================================================================
// Solo primitive `Card` dal barrel (no Stat/Badge custom). Titolo + valore
// grande + breakdown opzionale (children) + link opzionale in fondo.
// =============================================================================

interface StatCardProps {
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
