// @gestionale/ui — design system condiviso del core (ADR-0027 §D5 passo 2).
// Componenti shadcn agnostici + utility `cn`. Consumati da Next via
// `transpilePackages` (i sorgenti .tsx mantengono le direttive "use client").
export * from './alert';
export * from './avatar';
export type { BrandConfig } from './brand';
export * from './button';
export * from './card';
export * from './dialog';
export * from './dropdown-menu';
export * from './form';
export * from './input';
export * from './label';
export * from './sheet';
export * from './textarea';
export * from './utils';
