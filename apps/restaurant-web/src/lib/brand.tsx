// brand.tsx — Istanza BrandConfig del verticale restaurant (ADR-0061).
// Locale all'app: nessuna altra app la importa. `FoodDesk` è un segnaposto
// sostituibile. Sostituire `FoodDeskLogo` / `/icon.svg` con asset reali (stesso
// path/firma) non richiede altri cambi.
import type { SVGProps } from 'react';

import type { BrandConfig } from '@gestionale/ui';

// Wordmark placeholder: mark "piatto + posate" + nome prodotto. Tutto in
// `currentColor` → leggibile in light e dark. `{...props}` per ultimo: il
// consumer può sovrascrivere (es. `aria-hidden`, `className`).
function FoodDeskLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 168 32" fill="none" role="img" aria-label="FoodDesk" {...props}>
      <circle cx="14" cy="16" r="11.25" stroke="currentColor" strokeWidth="2.5" />
      {/* forchetta */}
      <path
        d="M9.5 10.5v3.2M12.5 10.5v3.2M11 10.5v11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* coltello */}
      <path d="M17.5 10.5v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <text
        x="34"
        y="22"
        fill="currentColor"
        fontSize="19"
        fontWeight="700"
        fontFamily="inherit"
        letterSpacing="-0.4"
      >
        FoodDesk
      </text>
    </svg>
  );
}

export const brand: BrandConfig = {
  productName: 'FoodDesk',
  Logo: FoodDeskLogo,
  favicon: '/icon.svg',
  tagline: 'Gestionale per la ristorazione',
};
