// =============================================================================
// seed-preflight.ts — call site del guard NODE_ENV (side-effect only)
// =============================================================================
// PERCHE' UN MODULO A SE' E NON UNA RIGA IN CIMA A seed.ts:
//
// `packages/db` e' ESM ("type": "module") e `seed.ts` importa il singleton
// `prisma` da `../src/index`, che lo istanzia EAGER al momento della
// valutazione del modulo (index.ts, `export const prisma = createPrismaClient()`).
// In ESM gli import sono hoisted: una statement scritta in cima a seed.ts
// girerebbe DOPO che `../src/index` e' stato valutato, quindi dopo che il
// client esiste — violando il requisito "abortire prima di istanziare il
// client e prima di qualunque query".
//
// I moduli importati sono invece valutati nell'ORDINE DI DICHIARAZIONE: basta
// che questo sia il PRIMO import di seed.ts perche' il guard giri per primo.
// Da qui l'import diretto di `../src/assert-valid-node-env` e non del barrel
// `../src/index`, che istanzierebbe proprio cio' che vogliamo precedere.
//
// Nota: `prisma` apre la connessione TCP in modo lazy (alla prima query), ma il
// requisito e' sull'istanziazione, non solo sulla connessione. Questo file
// soddisfa entrambi.
// =============================================================================

import { assertValidNodeEnv } from '../src/assert-valid-node-env';

/**
 * Ambiente validato del seed. Esportato perche' `seed.ts` decida il ramo dev
 * su un valore gia' verificato, invece di rileggere `process.env` e ricadere
 * nella logica per esclusione.
 */
export const SEED_NODE_ENV = assertValidNodeEnv(process.env.NODE_ENV);
