import Link from 'next/link';

// =============================================================================
// not-found.tsx — 404 page Next.js convention (TD-2 ADR-0012)
// =============================================================================
// Renderizzata su:
//   - Tenant slug invalido o reserved (middleware redirect)
//   - Route non match (Next.js fallback)
// =============================================================================
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-4xl font-bold">404 — Pagina non trovata</h1>
        <p className="mb-6 text-muted-foreground">
          La pagina richiesta non esiste oppure il tenant non &egrave; valido.
        </p>
        <Link href="/" className="text-primary underline">
          Torna alla home
        </Link>
      </div>
    </div>
  );
}
