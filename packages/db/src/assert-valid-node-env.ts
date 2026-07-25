// =============================================================================
// assert-valid-node-env.ts — guard fail-closed su NODE_ENV per il seed
// =============================================================================
// Il seed decideva il proprio comportamento su `NODE_ENV !== 'production'`:
// con la variabile ASSENTE finiva nel ramo dev e faceva upsert dei tenant
// `demo`/`acme` con password note (Admin123! / Manager123!). Quei tenant
// esistono gia' sul DB di produzione -> una riesecuzione senza la variabile
// avrebbe riportato quelle password ai default.
//
// Il presidio era "l'operatore si ricorda di passare NODE_ENV=production".
// Qui diventa meccanico: nessun default, set chiuso, l'assenza ABORTA.
//
// Funzione PURA (nessun accesso a process.env, nessun side-effect oltre il
// throw) -> interamente testabile. Il chiamante legge l'ambiente e passa il
// valore, stesso pattern di `assertSafeDbTarget`.
// =============================================================================

/** Ambienti ammessi. Set CHIUSO: tutto il resto, assenza inclusa, aborta. */
export const SEED_ENVS = ['production', 'development', 'test'] as const;

export type SeedEnv = (typeof SEED_ENVS)[number];

/**
 * Errore di abort quando `NODE_ENV` non e' uno dei valori ammessi. Messaggio
 * azionabile: nomina ENTRAMBI i gesti corretti, cosi' chi lo legge sa cosa
 * digitare invece di sapere solo cosa e' andato storto.
 */
export class InvalidNodeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNodeEnvError';
  }
}

/**
 * Ritorna il `NODE_ENV` validato, oppure aborta (`InvalidNodeEnvError`).
 *
 * Deliberatamente NON esiste un default: "se non e' production allora e' dev"
 * e' esattamente la logica che ha creato il problema che questo guard chiude.
 * Il confronto e' case-sensitive ed esatto: `prod`, `Production`, `staging` e
 * la stringa vuota sono tutti errori, non sinonimi da indovinare.
 *
 * @param nodeEnv valore grezzo di `process.env.NODE_ENV` (puo' essere undefined)
 */
export function assertValidNodeEnv(nodeEnv: string | undefined): SeedEnv {
  if (nodeEnv !== undefined && (SEED_ENVS as readonly string[]).includes(nodeEnv)) {
    return nodeEnv as SeedEnv;
  }

  const shown = nodeEnv === undefined ? '(non impostata)' : `'${nodeEnv}'`;

  throw new InvalidNodeEnvError(
    `FATAL: NODE_ENV=${shown} non ammessa per il seed. Valori ammessi: ${SEED_ENVS.join(', ')}.\n` +
      `Il seed NON assume un default: senza un valore esplicito non puo' sapere se creare i tenant\n` +
      `dev (demo/acme, password note) o saltarli.\n` +
      `  sviluppo:   pnpm --filter @gestionale/db db:seed        (NODE_ENV=development)\n` +
      `  produzione: pnpm --filter @gestionale/db db:seed:prod   (NODE_ENV=production)`,
  );
}

/**
 * `true` se l'ambiente ammette la creazione dei dati dev (tenant demo/acme,
 * utenti con password note). Espressa in POSITIVO su un set chiuso: il ramo
 * dev non deve essere raggiungibile per esclusione da `production`.
 */
export function allowsDevData(env: SeedEnv): boolean {
  return env === 'development' || env === 'test';
}
