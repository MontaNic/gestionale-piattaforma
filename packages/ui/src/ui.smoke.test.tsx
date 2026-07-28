import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Alert, AlertDescription, AlertTitle } from './alert';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { Label } from './label';
import { cn } from './utils';

// Smoke test del design system (ADR-0027 §D5 passo 2): i componenti principali
// renderizzano senza crash e applicano le props base. Non verifica lo stile
// pixel (responsabilita' di Tailwind/Playwright) ma la sanita' del render.

describe('cn', () => {
  it('unisce le classi e risolve i conflitti tailwind (last-wins)', () => {
    const hidden = false;
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', hidden && 'hidden', 'font-medium')).toBe('text-sm font-medium');
  });
});

describe('Button', () => {
  it("renderizza il children e di default e' un <button>", () => {
    render(<Button>Salva</Button>);
    const btn = screen.getByRole('button', { name: 'Salva' });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
  });

  it('applica la classe della variant', () => {
    render(<Button variant="destructive">Elimina</Button>);
    expect(screen.getByRole('button', { name: 'Elimina' })).toHaveClass('bg-destructive');
  });

  it("con asChild rende l'elemento figlio (Slot)", () => {
    render(
      <Button asChild>
        <a href="/dashboard">Vai</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Vai' });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});

describe('Badge', () => {
  it('renderizza il children come <span> con la variant di default', () => {
    render(<Badge>Bozza</Badge>);
    const badge = screen.getByText('Bozza');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('bg-muted', 'text-muted-foreground', 'rounded-full');
  });

  // Ogni variant applica la SUA coppia di token. È il test che impedisce di
  // reintrodurre un colore letterale al posto del token di stato. (Nessun nome
  // di utility letterale nemmeno qui: Tailwind scansiona il testo grezzo dei
  // file di questo package, commenti e test inclusi — vedi badge.tsx.)
  it.each([
    ['secondary', 'bg-secondary', 'text-secondary-foreground'],
    ['destructive', 'bg-destructive-soft', 'text-destructive-soft-foreground'],
    ['info', 'bg-info-soft', 'text-info'],
    ['success', 'bg-success-soft', 'text-success'],
    ['warn', 'bg-warn-soft', 'text-warn'],
  ] as const)('variant %s applica %s + %s', (variant, bg, fg) => {
    render(<Badge variant={variant}>Stato</Badge>);
    expect(screen.getByText('Stato')).toHaveClass(bg, fg);
  });

  it('size lg è la taglia KDS (px-3 py-1 text-sm)', () => {
    render(<Badge size="lg">Pronta</Badge>);
    expect(screen.getByText('Pronta')).toHaveClass('px-3', 'py-1', 'text-sm');
  });

  it('size default è la taglia base (px-2 py-0.5 text-xs)', () => {
    render(<Badge>Inviata</Badge>);
    expect(screen.getByText('Inviata')).toHaveClass('px-2', 'py-0.5', 'text-xs');
  });

  // `className` passa DENTRO cva (come Button): l'utility del call-site deve
  // vincere sul conflitto Tailwind, non essere sovrascritta dalla variant.
  it('className del call-site vince sul conflitto (cn/twMerge last-wins)', () => {
    render(<Badge className="px-4">Custom</Badge>);
    const badge = screen.getByText('Custom');
    expect(badge).toHaveClass('px-4');
    expect(badge).not.toHaveClass('px-2');
  });
});

describe('Input', () => {
  it('renderizza e propaga type/placeholder', () => {
    render(<Input type="email" placeholder="email@esempio.it" />);
    const input = screen.getByPlaceholderText('email@esempio.it');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'email');
  });
});

describe('Label', () => {
  it('renderizza il testo', () => {
    render(<Label htmlFor="x">Nome</Label>);
    expect(screen.getByText('Nome')).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('renderizza la composizione header/title/content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Titolo</CardTitle>
        </CardHeader>
        <CardContent>Contenuto</CardContent>
      </Card>,
    );
    expect(screen.getByText('Titolo')).toBeInTheDocument();
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('renderizza con role="alert" e applica la variant destructive', () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Errore</AlertTitle>
        <AlertDescription>Operazione fallita</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass('text-destructive');
    expect(screen.getByText('Errore')).toBeInTheDocument();
  });
});

describe('Dialog (Radix, richiede DOM)', () => {
  it('quando open mostra titolo e descrizione nel portal', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferma</DialogTitle>
            <DialogDescription>Sei sicuro?</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Conferma')).toBeInTheDocument();
    expect(screen.getByText('Sei sicuro?')).toBeInTheDocument();
  });
});
