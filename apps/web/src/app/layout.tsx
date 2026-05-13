import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gestionale',
  description: 'Piattaforma SaaS gestionale per ristorazione',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
