'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Globe, Mail, MapPin, Phone } from 'lucide-react';

import { Button } from '@gestionale/ui';

import { getPublicTenant } from '@/lib/public-tenant-api';
import type { PublicTenant } from '@/lib/public-tenant-api';

// =============================================================================
// t/[slug]/page.tsx — Landing pubblica dello studio (ADR-0049, Onda 2 Task 7)
// =============================================================================
// Single-page pre-login, stile Apple: hero centrato (logo + nome + descrizione)
// + contatti + unica CTA "Accedi". NESSUNA shell autenticata, nessun gating:
// vive nel layout slug (i18n + AuthProvider) ma non richiede login. Dati dal
// solo endpoint pubblico GET /public/tenants/:slug (api-client senza token),
// fetch client-side (NEXT_PUBLIC_API_URL relativo, browser-only). 404 backend
// (tenant inesistente/sospeso) → stato "studio non trovato".
// =============================================================================

export default function TenantLandingPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();

  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setNotFound(false);
    try {
      setTenant(await getPublicTenant(slug));
    } catch {
      // Qualsiasi errore (404 incluso) → stato non-trovato neutro, nessun leak.
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      </main>
    );
  }

  if (notFound || !tenant) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Studio non trovato</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Lo studio che stai cercando non è disponibile. Verifica il link ricevuto.
        </p>
      </main>
    );
  }

  const contatti: ReadonlyArray<{ icon: typeof Mail; label: string; href?: string }> = [
    tenant.indirizzo ? { icon: MapPin, label: tenant.indirizzo } : null,
    tenant.telefono
      ? { icon: Phone, label: tenant.telefono, href: `tel:${tenant.telefono.replace(/\s+/g, '')}` }
      : null,
    tenant.emailContatto
      ? { icon: Mail, label: tenant.emailContatto, href: `mailto:${tenant.emailContatto}` }
      : null,
    tenant.sitoWeb
      ? { icon: Globe, label: tenant.sitoWeb.replace(/^https?:\/\//, ''), href: tenant.sitoWeb }
      : null,
  ].filter((c): c is { icon: typeof Mail; label: string; href?: string } => c !== null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/40 px-6 py-20">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {tenant.logoUrl && (
          // Logo come background-image (non <img>): evita next/image (richiederebbe
          // remotePatterns per URL esterne) e la regola no-img-element, restando
          // pulito su entrambe le config eslint (root flat + next lint). ADR-0049.
          <div
            role="img"
            aria-label={`Logo ${tenant.name}`}
            className="mb-8 h-24 w-24 rounded-2xl bg-contain bg-center bg-no-repeat shadow-sm"
            style={{ backgroundImage: `url("${encodeURI(tenant.logoUrl)}")` }}
          />
        )}

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{tenant.name}</h1>

        {tenant.descrizione && (
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {tenant.descrizione}
          </p>
        )}

        <div className="mt-10">
          <Button asChild size="lg">
            <Link href={`/t/${tenant.slug}/login`}>Accedi</Link>
          </Button>
        </div>

        {contatti.length > 0 && (
          <ul className="mt-16 flex flex-col items-center gap-3 border-t pt-10 text-sm text-muted-foreground">
            {contatti.map((c) => {
              const Icon = c.icon;
              const content = (
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {c.label}
                </span>
              );
              return (
                <li key={c.label}>
                  {c.href ? (
                    <a
                      href={c.href}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel={c.href.startsWith('http') ? 'noreferrer' : undefined}
                      className="transition-colors hover:text-foreground"
                    >
                      {content}
                    </a>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
