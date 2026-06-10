'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@gestionale/ui';
import { CategoriaForm } from '@/components/scadenze/CategoriaForm';
import { createScadenzaCategoria } from '@/lib/scadenze-api';
import type { CreateScadenzaCategoriaInput, ScadenzaCategoria } from '@/lib/scadenze-types';

// =============================================================================
// CategorieSection.tsx — Sezione "Categorie personalizzate" (segue ADR-0040)
// =============================================================================
// Sezione in fondo a scadenze/page.tsx, modellata su ReferentiSection. NON possiede
// stato `categorie`: lo riceve dalla page (fetch unico in loadReference) e dopo un
// create chiama `onCreated` → la page refetcha, così la nuova categoria appare sia
// qui sia nel picker del ScadenzaForm (nessun doppio fetch).
//
// Le categorie piattaforma (tenantId NULL) sono mostrate con badge "Predefinita" e
// non modificabili; le custom del tenant (tenantId valorizzato) sono elencate sotto.
// Solo create: il backend non espone update/delete categorie. Bottone gated su
// `scadenze.gestisci` (canManage propagato dalla page).
// =============================================================================

interface CategorieSectionProps {
  categorie: ScadenzaCategoria[];
  canManage: boolean;
  /** Refetch della reference data della page (categorie + aziende). */
  onCreated: () => Promise<void>;
}

export function CategorieSection({
  categorie,
  canManage,
  onCreated,
}: CategorieSectionProps): JSX.Element {
  const t = useTranslations('scadenze');
  const [creating, setCreating] = useState(false);

  const custom = useMemo(() => categorie.filter((c) => c.tenantId !== null), [categorie]);
  const platform = useMemo(() => categorie.filter((c) => c.tenantId === null), [categorie]);

  async function handleCreate(input: CreateScadenzaCategoriaInput): Promise<void> {
    await createScadenzaCategoria(input);
    await onCreated();
    setCreating(false);
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('categorie.titolo')}</h2>
          <p className="text-sm text-muted-foreground">{t('categorie.sottotitolo')}</p>
        </div>
        {canManage && !creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('categorie.aggiungi')}
          </Button>
        )}
      </header>

      {creating && (
        <Card>
          <CardContent className="pt-6">
            <CategoriaForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-md border">
        <ul className="divide-y">
          {custom.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('categorie.empty')}</li>
          )}
          {custom.map((c) => (
            <li key={c.id} className="flex items-center gap-x-3 px-3 py-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.colore }}
                aria-hidden="true"
              />
              <span className="font-medium">{c.nome}</span>
            </li>
          ))}
          {platform.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-x-3 px-3 py-2 text-sm text-muted-foreground"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.colore }}
                aria-hidden="true"
              />
              <span>{c.nome}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {t('categorie.predefinita')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
