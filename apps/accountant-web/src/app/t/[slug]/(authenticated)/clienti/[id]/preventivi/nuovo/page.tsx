'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { PreventivoForm } from '@/components/preventivi/PreventivoForm';

// =============================================================================
// preventivi/nuovo/page.tsx — Crea preventivo (STOP-e2 ADR-0037)
// =============================================================================
// Route annidata sotto clienti/[id]. Active-state Sidebar a prefisso tiene
// "Clienti" attivo. Render dell'editor in modalità create. Il redirect
// post-submit (alla detail cliente) lo gestisce PreventivoForm.
// =============================================================================

export default function NuovoPreventivoPage(): JSX.Element {
  const t = useTranslations('preventivi');
  const params = useParams<{ slug: string; id: string }>();
  const { slug, id } = params;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/t/${slug}/clienti/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToCliente')}
      </Link>

      <h1 className="text-2xl font-semibold">{t('newPreventivo')}</h1>

      <PreventivoForm aziendaId={id} slug={slug} mode="create" />
    </div>
  );
}
