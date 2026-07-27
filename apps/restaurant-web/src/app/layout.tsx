import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';

import './globals.css';
import { brand } from '@/lib/brand';

// ADR-0083: la tipografia è condivisa (`--font-sans` in tokens.css punta a
// `--font-inter`). Restaurant ereditava il font di sistema — drift non
// dichiarato, non una decisione: qui viene chiuso allineandosi ad accountant.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: brand.productName,
  description: 'Piattaforma SaaS gestionale per ristorazione',
  applicationName: brand.productName,
  icons: { icon: brand.favicon },
};

// ADR-0018 Sub-DP-C: ThemeProvider a root (cross-tenant scope, user preference
// persistente via cookie next-themes). `suppressHydrationWarning` su <html>
// e' richiesto da next-themes — il provider aggiorna l'attributo `class`
// del root element prima del primo render React (script inline) per evitare
// flash del tema sbagliato.
//
// `lang="it"` resta hardcoded: la lingua del documento e' nello scope
// `[slug]/layout.tsx` (NextIntlClientProvider) per `useTranslations`,
// ma il <html lang> attribute richiede valore statico a build time.

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="it" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
