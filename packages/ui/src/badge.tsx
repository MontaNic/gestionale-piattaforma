import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './utils';

// =============================================================================
// badge.tsx — pastiglia di stato (ADR-0084 §PR2)
// =============================================================================
// Sostituisce i 24+ `<span>` pastiglia inline sparsi nei due verticali, e le 7
// mappe `STATO_BADGE`/`STATO_CLASS` che ne duplicavano il vocabolario di colore
// con rese divergenti (lo stesso verde in dark a due opacità diverse, lo stato
// "annullato" una volta su grigio letterale e una volta sul token neutro).
//
// Le variant NON sono inventate: vengono dai call-site reali. `default`,
// `secondary` e `destructive` erano già su token; `info`, `success` e `warn`
// erano letterali della scala Tailwind (blu / verde / ambra) e ora passano dai
// token di stato — legge #1 di ADR-0083, zero letterali.
//
// ⚠️ NIENTE nomi di utility letterali nei commenti di questo package: le app
// hanno `packages/ui/src/**` nel `content` di Tailwind, che estrae i candidati
// dal testo GREZZO del file. Un letterale citato in un commento diventa una
// regola CSS vera nel bundle di entrambe le app — verificato sul diff del build.
//
// `size="lg"` è la taglia del KDS, l'unica che divergeva dalla base: la board
// si legge da lontano.
//
// Server-safe di proposito (nessun `'use client'`): è un `<span>` senza stato
// né handler, e nessun altro file del barrel porta la direttiva.
// =============================================================================

const badgeVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive-soft text-destructive-soft-foreground',
        info: 'bg-info-soft text-info',
        success: 'bg-success-soft text-success',
        warn: 'bg-warn-soft text-warn',
      },
      size: {
        default: 'px-2 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm font-semibold',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size, className }))} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
