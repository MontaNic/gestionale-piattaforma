import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @gestionale/ui (design system, passo 2), @gestionale/i18n (meccanismo i18n,
  // passo 4), @gestionale/api-client (client HTTP FE, passo 5a) e
  // @gestionale/auth-web (auth FE, passo 5b) esportano i sorgenti .ts/.tsx: Next
  // li transpila qui, preservando "use client", i subpath server/edge e l'inline
  // delle env NEXT_PUBLIC_* (ADR-0027 §D5).
  transpilePackages: [
    '@gestionale/ui',
    '@gestionale/i18n',
    '@gestionale/api-client',
    '@gestionale/auth-web',
  ],
};

// ADR-0018 Sub-DP-A: localePrefix 'never' (cookie-based).
// Plugin riceve path config request-scoped (cookie reader NEXT_LOCALE).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
