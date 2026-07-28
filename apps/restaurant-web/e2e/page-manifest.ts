/**
 * page-manifest.ts — restaurant-web — single source of truth dello smoke tour.
 *
 * Principio (ADR smoke, STOP 1): le pagine visitate da un ruolo = le pagine a
 * cui il ruolo ha legittimamente accesso. Fase 1 copre solo Super Admin (tenant
 * `demo`) → TUTTE le pagine shell autenticate, incluse le placeholder
 * (comande/cassa/kds/report/settings): renderizzano una pagina statica, ma il
 * tour verifica comunque assenza di 403/≥500/pageerror.
 *
 * Derivazione empirica (STOP 0 + STOP 1):
 *  - page.tsx: apps/restaurant-web/src/app/t/[slug]/(authenticated)/**
 *  - NAV_ITEMS: apps/restaurant-web/src/components/shell/Sidebar.tsx
 *    (la sidebar restaurant NON filtra per permesso: tutte le voci sono visibili)
 *
 * Le rotte dinamiche ([menuId]) si risolvono navigando all'index e seguendo il
 * primo link di dettaglio. Lista vuota → skip con log.
 */

export type Surface = 'operatore';

export interface DynamicStrategy {
  indexPath: string;
  detailHrefIncludes?: string;
  /** Regex (source) sull'href del link di dettaglio — usata quando un substring
   *  sarebbe ambiguo (es. `/menu/listini` vs `/menu/<id>`). */
  detailHrefPattern?: string;
}

export interface PageEntry {
  path: string;
  dynamic?: DynamicStrategy;
  note?: string;
}

export interface RoleManifest {
  profile: string;
  slug: string;
  surface: Surface;
  pages: readonly PageEntry[];
}

export const RESTAURANT_MANIFEST: readonly RoleManifest[] = [
  {
    // Storage state riusato: apps/restaurant-web/e2e/.auth/demo.json (auth.setup.ts).
    profile: 'demo',
    slug: 'demo',
    surface: 'operatore',
    pages: [
      // Da P2/PR3 NON è più una welcome statica: fa fetch reali
      // (`/dashboard/stats` + `/conti`), ciascuno dietro il proprio permesso.
      // È per questo che il gate è PRIMA del fetch e non un try/catch: qui il
      // tour fallisce su qualunque response ≥400, anche se il JS la assorbe.
      { path: 'dashboard', note: 'landing con KPI + conti aperti, sezioni gated' },
      { path: 'menu' },
      { path: 'menu/listini' },
      { path: 'mappa', note: 'tavoli — pagina del bug 403 che motiva lo smoke' },
      { path: 'comande', note: 'PlaceholderPage' },
      { path: 'cassa', note: 'index cassa — conti aperti da incassare (PR2, ADR-0082)' },
      { path: 'kds', note: 'PlaceholderPage' },
      { path: 'report', note: 'PlaceholderPage' },
      { path: 'settings', note: 'PlaceholderPage' },
      {
        path: 'menu/[menuId]',
        // `/menu/listini` matcha un substring '/menu/'; uso pattern che esclude
        // 'listini' e prende il primo menu reale.
        dynamic: { indexPath: 'menu', detailHrefPattern: '/menu/(?!listini)[^/]+$' },
      },
    ],
  },
] as const;
