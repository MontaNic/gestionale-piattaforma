import * as React from 'react';

import { cn } from './utils';

// =============================================================================
// textarea.tsx — Multi-line text input (shadcn pattern, S19 ADR-0020)
// =============================================================================
// Allineato a input.tsx (stesse classi border/focus). Uso S19: descrizioni
// menu / articolo (campi `description`, `descriptionLong`).
// =============================================================================

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
