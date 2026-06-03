import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @gestionale/ui (design system, passo 2) e @gestionale/i18n (meccanismo i18n,
  // passo 4) esportano i sorgenti .ts/.tsx: Next li transpila qui, preservando le
  // direttive "use client" e i subpath server/edge (ADR-0027 §D5).
  transpilePackages: ['@gestionale/ui', '@gestionale/i18n'],
};

// ADR-0018 Sub-DP-A: localePrefix 'never' (cookie-based).
// Plugin riceve path config request-scoped (cookie reader NEXT_LOCALE).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
