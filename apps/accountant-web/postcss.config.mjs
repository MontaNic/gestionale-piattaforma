export default {
  plugins: {
    // ADR-0083: `globals.css` fa `@import` di `@gestionale/ui/src/tokens.css`.
    // Senza questo plugin Next lo tratta come modulo CSS separato e Tailwind vi
    // gira sopra da solo, senza `@tailwind base` (→ "`@layer base` is used but
    // no matching `@tailwind base` directive is present"). postcss-import lo
    // inlinea PRIMA di tailwindcss, che è anche la semantica della CLI usata
    // per il diff di invarianza.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
