import uiPreset from '@gestionale/ui/tailwind-preset';
import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  // Tema condiviso (ADR-0083): darkMode, container, colori→token, radii.
  // Qui restano solo le parti genuinamente per-app: `content` e `plugins`.
  presets: [uiPreset],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Design system condiviso (@gestionale/ui, ADR-0027 §D5 passo 2): le classi
    // usate dentro i componenti estratti vanno scansionate qui, altrimenti
    // Tailwind le purga e la resa cambia.
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
    // Auth FE condiviso (@gestionale/auth-web, passo 5b): AuthGate rende lo
    // spinner di loading con classi Tailwind — stessa esigenza di scansione.
    '../../packages/auth-web/src/**/*.{js,ts,jsx,tsx}',
  ],
  plugins: [tailwindcssAnimate],
};
export default config;
