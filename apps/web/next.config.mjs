/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Se Next 15 lamenta `@gestionale/db` (workspace dep dual package), attivare:
  // transpilePackages: ['@gestionale/db'],
};

export default nextConfig;
