import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @gestionale/ui esporta i sorgenti .tsx (design system condiviso, ADR-0027 §D5
  // passo 2): Next li transpila qui, preservando le direttive "use client".
  transpilePackages: ['@gestionale/ui'],
};

// ADR-0018 Sub-DP-A: localePrefix 'never' (cookie-based).
// Plugin riceve path config request-scoped (cookie reader NEXT_LOCALE).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
