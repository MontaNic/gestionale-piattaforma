import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AuthProvider } from '@gestionale/auth-web';

// =============================================================================
// app/t/[slug]/layout.tsx — Tenant-scoped providers (ADR-0018 Sub-DP-C)
// =============================================================================
// Server component (default). Wrap providers tenant-scoped:
//   - NextIntlClientProvider: messages caricati server-side via getMessages()
//     (next-intl request-scoped config legge cookie NEXT_LOCALE)
//   - AuthProvider: client component, slug propagato come prop da params
//
// Next.js 15: `params` e' una Promise — `await params` obbligatorio.
// Source: next.js.org/docs/app/api-reference/file-conventions/page#params-optional
// =============================================================================

export default async function TenantLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <AuthProvider slug={slug}>{children}</AuthProvider>
    </NextIntlClientProvider>
  );
}
