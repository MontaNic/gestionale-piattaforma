import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Se Next 15 lamenta `@gestionale/db` (workspace dep dual package), attivare:
  // transpilePackages: ['@gestionale/db'],
};

// ADR-0018 Sub-DP-A: localePrefix 'never' (cookie-based).
// Plugin riceve path config request-scoped (cookie reader NEXT_LOCALE).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
