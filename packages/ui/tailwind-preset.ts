/**
 * tailwind-preset.ts — tema condiviso del design system (ADR-0083).
 * ===========================================================================
 * Estratto una volta dalle due `tailwind.config.ts` per-app (che erano
 * byte-identiche → `TD-tailwind-config-dup`). Le app conservano il proprio file
 * per `content` (glob diversi) e `plugins`, e prendono il tema da qui.
 *
 * I valori NON vivono in questo file: sono CSS custom properties definite in
 * `src/tokens.css` (base condivisa) + blocco seam nei `globals.css` per-app.
 * Questo preset è solo il MAPPING nome-Tailwind → token — il che rende il
 * per-tenant futuro uno swap di valori senza toccare né preset né componenti.
 *
 * NOTA sulla forma `hsl(var(--x) / <alpha-value>)`: usata solo per i token
 * NUOVI. Le entry pre-esistenti restano `hsl(var(--x))` (senza supporto agli
 * opacity modifier) per non alterare la resa attuale — l'allineamento è
 * rimandato al ritocco delle primitive (P4).
 *
 * NON tipizzato con `Config` di tailwindcss di proposito: aggiungere il
 * pacchetto qui solo per un import di tipo ri-risolve il peer graph di `jiti`
 * e produce ~230 righe di churn nel lockfile. Stessa convenzione dei
 * `tailwind.config.ts` per-app, che sono fuori dal `include` dei rispettivi
 * tsconfig e quindi già oggi non typecheckati. La rete di sicurezza reale è il
 * diff del CSS generato (vedi ADR-0083 §Verifica).
 */
const preset = {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // --- token additivi (ADR-0083) ---------------------------------------
        // Tinta soffusa dell'accento: fondo degli stati attivi/selezionati.
        'accent-soft': {
          DEFAULT: 'hsl(var(--accent-soft) / <alpha-value>)',
          foreground: 'hsl(var(--accent-soft-foreground) / <alpha-value>)',
        },
        // Layer di brand (prima impressione: login, wordmark). NON è l'accento
        // operativo: non usarlo per le azioni di tutti i giorni.
        brand: {
          DEFAULT: 'hsl(var(--brand) / <alpha-value>)',
          foreground: 'hsl(var(--brand-foreground) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'hsl(var(--warn) / <alpha-value>)',
          soft: 'hsl(var(--warn-soft) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // `font-display` è additivo e oggi risolve a `--font-sans` (alias in
      // tokens.css): nessuna resa cambia finché non lo si adotta in P3.
      // La scala tipografica esplicita NON entra qui: è estetica, non seam.
      fontFamily: {
        display: 'var(--font-display)',
      },
    },
  },
};

export default preset;
