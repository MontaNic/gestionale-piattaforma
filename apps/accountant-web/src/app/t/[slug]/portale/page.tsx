'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

// =============================================================================
// portale/page.tsx — landing del portale cliente (ADR-0046 §5)
// =============================================================================
// Task 1 (fondamenta): pagina di benvenuto placeholder. Le superfici dati del
// cliente (documenti read-only per primo) arrivano coi task successivi. Conferma
// visivamente che login + redirect per tipo + shell cliente funzionano.
// =============================================================================

export default function PortaleHomePage(): JSX.Element {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Benvenuto nel portale</CardTitle>
          <CardDescription>
            {user ? `${user.firstName} ${user.lastName} · ${user.email}` : 'Area riservata clienti'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Da qui potrai consultare i documenti e le comunicazioni del tuo studio. Le sezioni
            saranno disponibili a breve.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
