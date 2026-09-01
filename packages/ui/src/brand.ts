// brand.ts — Descrittore di brand per-app (ADR-0061).
// =============================================================================
// Il brand è STRUTTURALE/build-time: ogni app web fornisce la PROPRIA istanza
// `BrandConfig` (es. apps/<app>/src/lib/brand.tsx), conforme a questo tipo.
// Nessuna app importa il brand di un'altra → aggiungere un'app = nuova
// istanza, non clonare login/metadata. Oggi l'app è una sola: il tipo resta
// perché è anche il punto d'innesto del branding per-tenant.
//
// Fuori scope per design:
// - NIENTE colori: la palette resta nei `globals.css` per-app (dimensione V già
//   divergente, non si tocca). Il brand object non ridefinisce i token.
// - NIENTE identità per-tenant (logo del singolo studio, ADR-0049): quella è la
//   dimensione T, runtime, e non passa di qui.
// =============================================================================

import type { ComponentType, SVGProps } from 'react';

export interface BrandConfig {
  /** Nome prodotto dell'app (proper noun, NON tradotto). Es. "StudioDesk". */
  productName: string;

  /**
   * Wordmark dell'app come componente SVG. DEVE rendere in light e dark:
   * usa `currentColor` (eredita il colore testo del contenitore), mai colori
   * fissi che spariscono su un tema. Sostituibile con un asset reale conforme.
   */
  Logo: ComponentType<SVGProps<SVGSVGElement>>;

  /** Path pubblico del favicon (servito da Next via file-convention `app/icon`). */
  favicon: string;

  /** Tagline opzionale dell'app. */
  tagline?: string;
}
