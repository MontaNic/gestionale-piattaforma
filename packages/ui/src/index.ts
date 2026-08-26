// @gestionale/ui — design system condiviso del core (ADR-0027 §D5 passo 2).
// Componenti shadcn + utility `cn`. Consumati da Next via `transpilePackages`
// (i sorgenti .tsx mantengono le direttive "use client").
//
// NON e' framework-agnostico: `stat-card.tsx` importa `next/link`, e `next` e'
// peer dependency del package (PR0 del restyling, amendment ADR-0083).
// L'agnosticismo era una proprieta' senza consumer — entrambe le app sono Next
// 15 e nessun altro pacchetto importa questo. Trigger per riconsiderare: la
// comparsa di un consumer non-Next.
export * from './alert';
export * from './avatar';
export * from './badge';
export type { BrandConfig } from './brand';
export * from './button';
export * from './card';
export * from './dialog';
export * from './dropdown-menu';
export * from './form';
export * from './input';
export * from './label';
export * from './sheet';
export * from './stat-card';
export * from './textarea';
export * from './utils';
