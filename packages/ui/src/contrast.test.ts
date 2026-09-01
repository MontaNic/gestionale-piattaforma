import { describe, expect, it } from 'vitest';

import {
  AA,
  appNames,
  appTokenSheet,
  type Layer,
  type PairKind,
  parseTokenSheet,
  ratioOf,
  scanStateTokenUsages,
  type Theme,
  type TokenSheet,
} from './contrast';

// =============================================================================
// contrast.test.ts — IL GATE di contrasto (ADR-0085, amendment P3b-alpha)
// =============================================================================
// ADR-0085 misuro' le coppie di stato a mano, una volta, e — si e' scoperto poi
// — di fatto in un tema solo. Da qui in avanti la misura e' automatica e ha
// quattro proprieta' che la tabella dell'ADR non aveva:
//
//  1. legge i valori VERI da `tokens.css` e dai blocchi seam per-verticale,
//     quindi nessuna coppia resta fuori perche' vive in un altro file;
//  2. i rapporti sono PINNATI: una deriva dei token diventa rossa invece di
//     passare inosservata;
//  3. non ammette una coppia sotto soglia SENZA una nota scritta — e nemmeno
//     una nota rimasta su una coppia rientrata;
//  4. censisce gli usi reali nei sorgenti e pretende che ogni token trovato
//     appartenga a una coppia dichiarata: senza questo verificherebbe solo
//     cio' che gli abbiamo detto di verificare, cioe' un falso verde per
//     costruzione.
//
// Un gate che non puo' diventare rosso non e' un gate: l'ultimo `describe` lo
// dimostra sui VALORI PRE-CORREZIONE, che sono una coppia nota-cattiva reale e
// misurata — e' la prova migliore disponibile, perche' dimostra che il gate
// avrebbe intercettato il difetto che questa PR corregge.
//
// ⚠️ Nessun nome di utility letterale in questo file (ADR-0085 §D5): Tailwind
// scansiona il testo grezzo di `packages/ui/src/**` in ENTRAMBE le app. Le
// coppie sono dichiarate coi nomi delle CUSTOM PROPERTY, non delle classi.
// =============================================================================

interface DeclaredPair {
  /** etichetta leggibile, usata nel report */
  id: string;
  fg: Layer;
  bg: Layer;
  /** fondo del tema scuro, quando il call-site lo scrive diverso */
  bgDark?: Layer;
  kind: PairKind;
  /** verticale di cui usare il seam; assente = solo i token condivisi */
  app?: string;
  /** file (relativi alla radice del workspace) in cui la coppia e' usata */
  usi: string[];
  /** rapporti attesi, pinnati a 2 decimali: la deriva dei token diventa rossa */
  atteso: { root: number; dark: number };
  /**
   * Obbligatoria quando la coppia non raggiunge la soglia: dice PERCHE' resta
   * dov'e'. Il gate rifiuta sia una coppia sotto soglia senza nota, sia una
   * nota rimasta su una coppia rientrata.
   */
  sottoSoglia?: string;
}

// --- inventario --------------------------------------------------------------
// Le superfici non sono un elenco a piacere: sono quelle su cui la coppia si
// presenta davvero. Le pastiglie (forte su soffuso) sono l'unica forma che
// ADR-0085 aveva misurato; `--background` e `--card` sono le superfici che
// l'adozione nei call-site accountant (P3b-0) introduce, e che nessuno aveva
// mai misurato. `--muted` entra per la bolla di nota interna, che P3b-0
// portera' sul neutro e non su uno stato.

const soft = (token: string): DeclaredPair['bg'] => ({ token: `${token}-soft` });

const PAIRS: DeclaredPair[] = [
  // --- stato di attenzione ---------------------------------------------------
  {
    id: 'attenzione · forte su soffuso',
    fg: { token: 'warn' },
    bg: soft('warn'),
    kind: 'text',
    usi: [
      'packages/ui/src/badge.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/mandati/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/circolari/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/circolari/[id]/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/scadenze/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/comunicazioni/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/portale/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/portale/circolari/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/portale/circolari/[id]/page.tsx',
      'apps/accountant-web/src/components/note-spese/NotaSpesaForm.tsx',
    ],
    atteso: { root: 4.5, dark: 8.99 },
  },
  {
    id: 'attenzione · forte su fondo pagina',
    fg: { token: 'warn' },
    bg: { token: 'background' },
    kind: 'text',
    usi: [
      'apps/accountant-web/src/components/note-spese/NotaSpesaRow.tsx',
      'apps/accountant-web/src/components/note-spese/NotaSpesaForm.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/approvazione-spese/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/portale/circolari/[id]/page.tsx',
    ],
    atteso: { root: 5.01, dark: 11.99 },
  },
  {
    id: 'attenzione · forte su superficie card',
    fg: { token: 'warn' },
    bg: { token: 'card' },
    kind: 'text',
    usi: [],
    atteso: { root: 5.01, dark: 11.99 },
  },
  // --- stato positivo --------------------------------------------------------
  {
    id: 'positivo · forte su soffuso',
    fg: { token: 'success' },
    bg: soft('success'),
    kind: 'text',
    usi: [
      'packages/ui/src/badge.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/mandati/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/circolari/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/circolari/[id]/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/approvazione-spese/page.tsx',
      'apps/accountant-web/src/components/note-spese/NotaSpesaRow.tsx',
    ],
    atteso: { root: 4.57, dark: 8.55 },
  },
  {
    id: 'positivo · forte su fondo pagina',
    fg: { token: 'success' },
    bg: { token: 'background' },
    kind: 'text',
    usi: [
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/portale/circolari/[id]/page.tsx',
    ],
    atteso: { root: 5.02, dark: 11.47 },
  },
  {
    id: 'positivo · forte su superficie card',
    fg: { token: 'success' },
    bg: { token: 'card' },
    kind: 'text',
    usi: [],
    atteso: { root: 5.02, dark: 11.47 },
  },
  // --- stato informativo -----------------------------------------------------
  {
    id: 'informativo · forte su soffuso',
    fg: { token: 'info' },
    bg: soft('info'),
    kind: 'text',
    usi: [
      'packages/ui/src/badge.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/mandati/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/approvazione-spese/page.tsx',
      'apps/accountant-web/src/components/note-spese/NotaSpesaRow.tsx',
      'apps/accountant-web/src/components/preventivi/PreventiviSection.tsx',
      'apps/accountant-web/src/components/dashboard/UltimiPreventivi.tsx',
    ],
    atteso: { root: 5.5, dark: 5.77 },
  },
  {
    id: 'informativo · forte su fondo pagina',
    fg: { token: 'info' },
    bg: { token: 'background' },
    kind: 'text',
    usi: [],
    atteso: { root: 6.71, dark: 7.85 },
  },
  {
    id: 'informativo · forte su superficie card',
    fg: { token: 'info' },
    bg: { token: 'card' },
    kind: 'text',
    usi: [],
    atteso: { root: 6.71, dark: 7.85 },
  },
  // --- stato distruttivo -----------------------------------------------------
  {
    id: 'distruttivo · forte su soffuso',
    fg: { token: 'destructive-soft-foreground' },
    bg: soft('destructive'),
    kind: 'text',
    usi: ['packages/ui/src/badge.tsx'],
    atteso: { root: 5.29, dark: 5.84 },
  },
  {
    id: 'distruttivo · forte su fondo pagina',
    fg: { token: 'destructive-soft-foreground' },
    bg: { token: 'background' },
    kind: 'text',
    usi: ['apps/accountant-web/src/app/t/[slug]/(authenticated)/report/margine/page.tsx'],
    atteso: { root: 6.46, dark: 7.23 },
  },
  {
    id: 'distruttivo · forte su superficie card',
    fg: { token: 'destructive-soft-foreground' },
    bg: { token: 'card' },
    kind: 'text',
    usi: [],
    atteso: { root: 6.46, dark: 7.23 },
  },
  // --- neutri consumati dalle stesse pastiglie -------------------------------
  {
    id: 'neutro · variant di default',
    fg: { token: 'muted-foreground' },
    bg: { token: 'muted' },
    kind: 'text',
    usi: [
      'packages/ui/src/badge.tsx',
      'apps/accountant-web/src/app/t/[slug]/(authenticated)/mandati/page.tsx',
    ],
    atteso: { root: 4.34, dark: 5.7 },
    sottoSoglia:
      '⚠️ DIFETTO ATTIVO, non latente. La coppia neutra ereditata da shadcn sta a 4.34 contro 4.5 in ' +
      'chiaro, e da P3b-0 ha un CONSUMER REALE: lo stato `annullato` dei mandati, che ci arriva da una ' +
      'coppia letterale che stava a 8.33 in entrambi i temi. Fino a P3b-0 era una coppia senza call-site ' +
      'applicativi e la nota poteva dire "difetto del sistema, si vedra’"; ora c’e’ una pagina che lo ' +
      'rende, e il debito ha una vittima con un nome — ' +
      'apps/accountant-web/.../mandati/page.tsx, la voce `annullato`. ' +
      'NON e’ alzabile qui: e’ un neutro CONDIVISO, e cambiarlo muoverebbe anche il restaurant fuori ' +
      'dalla fase che possiede i neutri. Trigger: P3b — e quando P3b arriva questa NON e’ una voce di ' +
      'lista fra tante, e’ l’unica coppia sotto soglia che qualcuno vede davvero.',
  },
  {
    id: 'neutro · variant secondary',
    fg: { token: 'secondary-foreground' },
    bg: { token: 'secondary' },
    kind: 'text',
    usi: ['packages/ui/src/badge.tsx'],
    atteso: { root: 16.3, dark: 13.95 },
  },
  {
    id: 'neutro · testo corrente su superficie attenuata',
    fg: { token: 'foreground' },
    bg: { token: 'muted' },
    kind: 'text',
    usi: ['apps/accountant-web/src/app/t/[slug]/(authenticated)/comunicazioni/[id]/page.tsx'],
    atteso: { root: 18.25, dark: 13.95 },
  },
  {
    id: 'neutro · testo corrente su fondo pagina',
    fg: { token: 'foreground' },
    bg: { token: 'background' },
    kind: 'text',
    usi: ['apps/accountant-web/src/components/note-spese/CalendarioMese.tsx'],
    atteso: { root: 19.99, dark: 19.09 },
  },
  // --- seam per-verticale ----------------------------------------------------
  // In scuro il call-site consuma il fondo a opacita' ridotta: la coppia NON e'
  // la stessa nei due temi, e misurarla come se lo fosse la falserebbe.
  {
    id: 'seam accountant · tinta soffusa dell’accento (voce di nav attiva)',
    fg: { token: 'accent-soft-foreground' },
    bg: { token: 'accent-soft' },
    bgDark: { token: 'accent-soft', alpha: 0.3, under: { token: 'background' } },
    kind: 'text',
    app: 'accountant-web',
    usi: ['apps/accountant-web/src/components/shell/Sidebar.tsx'],
    atteso: { root: 8.48, dark: 14.36 },
  },
];

const base = parseTokenSheet();
const sheets = new Map<string, TokenSheet>(appNames().map((a) => [a, appTokenSheet(a)]));

const sheetOf = (p: DeclaredPair): TokenSheet => (p.app ? (sheets.get(p.app) ?? base) : base);

const ratio = (p: DeclaredPair, theme: Theme, sheet: TokenSheet = sheetOf(p)): number =>
  Number(ratioOf(sheet, theme, p.fg, theme === 'dark' && p.bgDark ? p.bgDark : p.bg).toFixed(2));

const peggiore = (p: DeclaredPair, sheet: TokenSheet = sheetOf(p)): number =>
  Math.min(ratio(p, 'root', sheet), ratio(p, 'dark', sheet));

// --- il report ---------------------------------------------------------------
// Il numero, non il pass/fail: i casi al limite li giudica una persona.

describe('coppie di token — report', () => {
  it('stampa i rapporti misurati sui valori reali dei fogli di token', () => {
    // Stampato a mano, riga per riga. Il metodo di `console` che formatta una
    // griglia NON si puo' usare qui, e nemmeno nominare: il suo nome coincide
    // con un'utility di layout, Tailwind lo estrae dal testo grezzo di questo
    // file e la chiamata emetteva una regola vera nel bundle di ENTRAMBE le
    // app. Trovato dal diff del CSS, non a vista — ADR-0085 §D5 che si
    // ripresenta su un nome che non e' un colore.
    const righe = PAIRS.map((p) => {
      const min = AA[p.kind];
      const esito = peggiore(p) >= min ? 'AA' : `SOTTO ${min}`;
      return `${p.id.padEnd(58)} chiaro ${ratio(p, 'root').toFixed(2).padStart(5)}  scuro ${ratio(
        p,
        'dark',
      )
        .toFixed(2)
        .padStart(5)}  ${esito}`;
    });
    console.log(['', ...righe, ''].join('\n'));
    expect(righe).toHaveLength(PAIRS.length);
  });
});

// --- il gate -----------------------------------------------------------------

describe('coppie di token — gate', () => {
  it('l’inventario non e’ vuoto (zero coppie esaminate = rosso, mai verde)', () => {
    expect(PAIRS.length).toBeGreaterThan(0);
    expect(sheets.size).toBeGreaterThan(0);
  });

  it('ogni verticale trovato su disco ha una coppia di seam dichiarata', () => {
    const conSeam = new Set(PAIRS.map((p) => p.app).filter(Boolean));
    expect([...sheets.keys()].filter((a) => !conSeam.has(a))).toEqual([]);
  });

  it.each(PAIRS.map((p) => [p.id, p] as const))(
    '%s — i rapporti restano quelli pinnati',
    (_id, p) => {
      expect({ root: ratio(p, 'root'), dark: ratio(p, 'dark') }).toEqual(p.atteso);
    },
  );

  it.each(PAIRS.map((p) => [p.id, p] as const))(
    '%s — raggiunge AA oppure porta una nota scritta',
    (_id, p) => {
      const min = AA[p.kind];
      if (peggiore(p) >= min) {
        // Una nota rimasta su una coppia rientrata e' rumore che col tempo
        // diventa bugia: il gate la fa cadere.
        expect(p.sottoSoglia, 'coppia rientrata: rimuovere la nota').toBeUndefined();
      } else {
        expect(p.sottoSoglia, `coppia a ${peggiore(p)} < ${min} senza nota`).toBeTruthy();
      }
    },
  );
});

// --- il censimento -----------------------------------------------------------

describe('usi dei token nei sorgenti', () => {
  const usages = scanStateTokenUsages();

  it('trova almeno un uso (un censimento vuoto sarebbe un gate cieco)', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('ogni uso appartiene a una coppia dichiarata qui', () => {
    const catena = (l: Layer): string[] => (l.under ? [l.token, ...catena(l.under)] : [l.token]);
    const famigliePerFile = new Map<string, Set<string>>();
    for (const p of PAIRS) {
      const famiglie = [p.fg, p.bg, ...(p.bgDark ? [p.bgDark] : [])].flatMap(catena);
      for (const file of p.usi) {
        const set = famigliePerFile.get(file) ?? new Set<string>();
        famiglie.forEach((f) => set.add(f));
        famigliePerFile.set(file, set);
      }
    }
    const buchi = usages.filter((u) => !famigliePerFile.get(u.file)?.has(u.family));
    expect(
      buchi.map((u) => `${u.file}:${u.line} ${u.prefix}·${u.family}`),
      'token usato in un punto che nessuna coppia dichiarata copre',
    ).toEqual([]);
  });
});

// --- prova di efficacia ------------------------------------------------------
// I valori PRE-CORREZIONE: il gradino forte scelto da ADR-0085 come foreground
// in tema chiaro. Non sono una coppia inventata per far fallire il test — sono
// cio' che stava in `tokens.css` fino a questa PR.

const PRE_CORREZIONE: Record<string, string> = {
  warn: '32.1 94.6% 43.7%',
  success: '142.1 76.2% 36.3%',
  info: '221.2 83.2% 53.3%',
  'destructive-soft-foreground': '0 72.2% 50.6%',
};

describe('prova di efficacia del gate', () => {
  const guasto: TokenSheet = { root: { ...base.root, ...PRE_CORREZIONE }, dark: base.dark };

  it('sui valori pre-correzione la stessa asserzione diventa rossa', () => {
    const bocciate = PAIRS.filter((p) => !p.app).filter((p) => peggiore(p, guasto) < AA[p.kind]);
    expect(bocciate.map((p) => `${p.id} → ${peggiore(p, guasto)}`)).not.toEqual([]);
    // I due casi peggiori, nominati: sono i numeri che hanno motivato la PR.
    expect(ratio(PAIRS[0] as DeclaredPair, 'root', guasto)).toBe(2.87);
    expect(ratio(PAIRS[3] as DeclaredPair, 'root', guasto)).toBe(3.0);
  });

  it('sui valori correnti le stesse coppie tornano verdi', () => {
    const bocciate = PAIRS.filter((p) => !p.app)
      .filter((p) => p.sottoSoglia === undefined)
      .filter((p) => peggiore(p) < AA[p.kind]);
    expect(bocciate.map((p) => `${p.id} → ${peggiore(p)}`)).toEqual([]);
  });
});
