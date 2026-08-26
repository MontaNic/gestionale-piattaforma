// =============================================================================
// contrast.ts — motore del gate di contrasto (ADR-0085, amendment P3b-0)
// =============================================================================
// ADR-0085 ha misurato le coppie di stato UNA VOLTA, a mano, e SOLO nella forma
// isolata (colore forte sulla propria tinta soffusa). L'adozione dei token nei
// call-site reali (P3b-0) introduce coppie che nessuno aveva misurato — il
// colore forte direttamente sulle superfici neutre — e nessun criterio
// automatico impediva a una di esse di essere illeggibile.
//
// Questo modulo e' il criterio: legge i valori VERI da `tokens.css` (non a
// memoria, non copiati in un array) e calcola il rapporto di contrasto WCAG 2.1
// per una coppia dichiarata, in entrambi i temi. L'inventario delle coppie e le
// asserzioni vivono in `contrast.test.ts`, che e' il gate vero e proprio.
//
// NON e' esportato dal barrel `index.ts`: e' strumento di verifica a build-time,
// non superficie runtime del design system. Nessun componente lo importa.
//
// ⚠️ NIENTE nomi di utility letterali in questo file, nemmeno nei commenti,
// nemmeno dentro le regex: le app hanno `packages/ui/src/**` nel `content` di
// Tailwind, che estrae i candidati dal testo GREZZO — un nome citato qui
// diventa una regola CSS vera nel bundle di ENTRAMBE le app (ADR-0085 §D5).
// Per questo il vocabolario sotto elenca solo le famiglie di token (la parte
// DOPO il trattino) e i prefissi vengono catturati dalla regex, mai scritti.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- colore -----------------------------------------------------------------

/** Componenti sRGB in [0,1]. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Converte il valore di una custom property nella forma usata da `tokens.css`
 * (`"222.2 84% 4.9%"`, cioe' i tre argomenti di `hsl()` senza la funzione).
 */
export function hslToRgb(value: string): Rgb {
  const parts = value.trim().replace(/%/g, '').split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`valore HSL non riconosciuto: "${value}"`);
  }
  const [h, s, l] = parts as [number, number, number];
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const wheel: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = wheel[Math.floor((((h % 360) + 360) % 360) / 60) % 6] as [
    number,
    number,
    number,
  ];
  return { r: r + m, g: g + m, b: b + m };
}

/**
 * Composizione alpha, come la fa il browser: interpolazione lineare nello
 * spazio sRGB gamma-encoded. Serve ai layer consumati a opacita' ridotta.
 */
export function mix(front: Rgb, alpha: number, back: Rgb): Rgb {
  return {
    r: front.r * alpha + back.r * (1 - alpha),
    g: front.g * alpha + back.g * (1 - alpha),
    b: front.b * alpha + back.b * (1 - alpha),
  };
}

/** Luminanza relativa WCAG 2.1 §relative-luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapporto di contrasto WCAG 2.1, sempre >= 1, ordine degli argomenti libero. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- token ------------------------------------------------------------------

/** Valori delle custom property, per tema. Chiave = nome senza `--`. */
export interface TokenSheet {
  root: Record<string, string>;
  dark: Record<string, string>;
}

const TOKENS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css');

/**
 * Estrae i valori dai blocchi `:root` e `.dark`. Legge il file reale: se un
 * token cambia valore, il gate lo vede al run successivo senza che nessuno
 * aggiorni una copia (e' la ragione per cui i rapporti attesi sono pinnati nel
 * test: una deriva di `tokens.css` deve diventare rossa, non passare).
 */
export function parseTokenSheet(css: string = readFileSync(TOKENS_FILE, 'utf8')): TokenSheet {
  const grab = (selector: string): Record<string, string> => {
    const start = css.indexOf(selector);
    if (start < 0) throw new Error(`blocco "${selector}" non trovato in tokens.css`);
    const open = css.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const out: Record<string, string> = {};
    for (const [, name, value] of css.slice(open, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      out[name as string] = (value as string).trim();
    }
    return out;
  };
  return { root: grab(':root'), dark: grab('.dark') };
}

// --- coppie -----------------------------------------------------------------

/** Un layer di colore: un token, eventualmente a opacita' ridotta su un altro. */
export interface Layer {
  /** nome della custom property, senza `--` */
  token: string;
  /** opacita' con cui e' applicato (assente = pieno) */
  alpha?: number;
  /** cio' che sta sotto, obbligatorio quando `alpha` e' presente */
  under?: Layer;
}

/**
 * Soglie WCAG 2.1 AA. `text` = testo normale (1.4.3), `text-large` = testo
 * grande (>= 18.66px bold o >= 24px), `non-text` = confini di componenti e
 * grafica (1.4.11).
 */
export const AA: Record<PairKind, number> = {
  text: 4.5,
  'text-large': 3,
  'non-text': 3,
};

export type PairKind = 'text' | 'text-large' | 'non-text';

export type Theme = 'root' | 'dark';

export function resolveLayer(vars: Record<string, string>, layer: Layer): Rgb {
  const value = vars[layer.token];
  if (value === undefined) throw new Error(`token "${layer.token}" assente dal tema`);
  const own = hslToRgb(value);
  if (layer.alpha === undefined) return own;
  if (!layer.under) throw new Error(`layer "${layer.token}" ha alpha ma nessun layer sotto`);
  return mix(own, layer.alpha, resolveLayer(vars, layer.under));
}

/** Rapporto di contrasto di una coppia, nel tema richiesto. */
export function ratioOf(sheet: TokenSheet, theme: Theme, fg: Layer, bg: Layer): number {
  const vars = theme === 'root' ? sheet.root : { ...sheet.root, ...sheet.dark };
  return contrastRatio(resolveLayer(vars, fg), resolveLayer(vars, bg));
}

// --- censimento degli usi ----------------------------------------------------

/**
 * Le famiglie di token di stato, senza prefisso di utility. Ordine
 * significativo: le piu' lunghe prima, altrimenti la variante soffusa viene
 * troncata dalla nuda.
 */
export const STATE_TOKEN_FAMILIES = [
  'destructive-soft-foreground',
  'destructive-soft',
  'accent-soft-foreground',
  'accent-soft',
  'warn-soft',
  'success-soft',
  'info-soft',
  'warn',
  'success',
  'info',
] as const;

export interface TokenUsage {
  /** path relativo alla radice del workspace */
  file: string;
  line: number;
  /** prefisso dell'utility, catturato dal sorgente e mai scritto qui */
  prefix: string;
  family: string;
  alpha?: number;
}

// La coda `(?![-\w])` non e' cosmetica: senza, una parola composta qualunque
// (`no-info-leak` in un commento di `packages/auth`) viene contata come uso di
// un token. Il censimento e' volutamente largo — falso positivo rumoroso e'
// meglio di uso non visto — ma non deve essere rumoroso a vuoto.
const USAGE_RE = new RegExp(
  String.raw`\b([a-z]+)-(${STATE_TOKEN_FAMILIES.join('|')})(?:\/(\d{1,3}))?(?![-\w])`,
  'g',
);

/** Radice del workspace: il primo antenato con `pnpm-workspace.yaml`. */
export function workspaceRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    try {
      statSync(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) throw new Error('radice del workspace non trovata');
      dir = up;
    }
  }
}

/**
 * Tutte le cartelle sorgente scansionate da Tailwind: `apps/<x>/src` e
 * `packages/<x>/src`. Derivate dal filesystem e non elencate a mano, cosi' un
 * verticale nuovo entra nel gate senza che nessuno se ne ricordi.
 */
export function sourceRoots(root: string = workspaceRoot()): string[] {
  const out: string[] = [];
  for (const group of ['apps', 'packages']) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const name of entries) {
      const src = join(root, group, name, 'src');
      try {
        if (statSync(src).isDirectory()) out.push(src);
      } catch {
        /* workspace senza src */
      }
    }
  }
  if (out.length === 0) throw new Error('nessuna cartella sorgente trovata: gate cieco');
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
}

/**
 * Censisce ogni utility costruita su un token di stato nei sorgenti. E' la
 * meta' del gate che nessuna tabella puo' dare: dice se il codice usa una
 * coppia che l'inventario non dichiara.
 *
 * Esclusi i file `*.test.*` (asseriscono stringhe di classe, non sono
 * call-site) e questo modulo, che nomina le famiglie per definirle.
 */
export function scanStateTokenUsages(
  roots: string[] = sourceRoots(),
  root: string = workspaceRoot(),
): TokenUsage[] {
  const files: string[] = [];
  for (const dir of roots) walk(dir, files);
  const self = fileURLToPath(import.meta.url);
  const usages: TokenUsage[] = [];
  for (const file of files) {
    if (file === self) continue;
    const rel = relative(root, file).split(sep).join('/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        for (const m of text.matchAll(USAGE_RE)) {
          usages.push({
            file: rel,
            line: i + 1,
            prefix: m[1] as string,
            family: m[2] as string,
            ...(m[3] ? { alpha: Number(m[3]) / 100 } : {}),
          });
        }
      });
  }
  return usages;
}

// --- seam per-verticale ------------------------------------------------------
// La coppia soffusa dell'accento NON vive in `tokens.css`: e' seam, e ogni
// verticale la definisce nel proprio `globals.css`. Misurarla sul solo file
// condiviso vorrebbe dire non misurarla affatto — il gate legge quindi anche i
// blocchi per-app e li sovrappone alla base, che e' l'ordine della cascata
// reale (`@import` di tokens.css, poi il blocco seam).

/** Nome dei verticali che hanno un `globals.css` con blocco seam. */
export function appNames(root: string = workspaceRoot()): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, 'apps'))) {
    try {
      statSync(join(root, 'apps', name, 'src', 'app', 'globals.css'));
      out.push(name);
    } catch {
      /* workspace senza foglio di stile globale (le API) */
    }
  }
  if (out.length === 0) throw new Error('nessun verticale con globals.css: gate cieco');
  return out;
}

/** Base condivisa + override del seam di `app`, nell'ordine della cascata. */
export function appTokenSheet(app: string, root: string = workspaceRoot()): TokenSheet {
  const base = parseTokenSheet();
  const seam = parseTokenSheet(
    readFileSync(join(root, 'apps', app, 'src', 'app', 'globals.css'), 'utf8'),
  );
  return {
    root: { ...base.root, ...seam.root },
    dark: { ...base.dark, ...seam.dark },
  };
}
