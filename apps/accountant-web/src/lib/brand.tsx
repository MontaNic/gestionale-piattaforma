// brand.tsx — Istanza BrandConfig del verticale accountant (ADR-0061).
// Locale all'app: nessuna altra app la importa. Sostituire `StudioDeskLogo` /
// `/icon.svg` con asset reali (stesso path/firma) non richiede altri cambi.
import type { SVGProps } from 'react';

import type { BrandConfig } from '@gestionale/ui';

// Wordmark placeholder: mark "documento/scrivania" + nome prodotto. Tutto in
// `currentColor` → eredita il colore testo del contenitore, leggibile in
// light e dark. `{...props}` per ultimo: il consumer può sovrascrivere
// (es. `aria-hidden`, `className` per dimensione/colore).
function StudioDeskLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 184 32" fill="none" role="img" aria-label="StudioDesk" {...props}>
      <rect
        x="1.25"
        y="5.25"
        width="21.5"
        height="21.5"
        rx="5.5"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M7 13h10M7 17h10M7 21h6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text
        x="34"
        y="22"
        fill="currentColor"
        fontSize="19"
        fontWeight="700"
        fontFamily="inherit"
        letterSpacing="-0.4"
      >
        StudioDesk
      </text>
    </svg>
  );
}

export const brand: BrandConfig = {
  productName: 'StudioDesk',
  Logo: StudioDeskLogo,
  favicon: '/icon.svg',
  tagline: 'Gestionale per studi commercialisti',
};
