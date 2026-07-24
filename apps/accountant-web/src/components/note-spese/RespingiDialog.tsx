'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gestionale/ui';

// =============================================================================
// RespingiDialog — rifiuto con motivo obbligatorio (§3, PR-5)
// =============================================================================
// Il `motivo` è ciò che l'autore leggerà per correggere (PR-4 lo mostra in
// evidenza sulla nota respinta): presentato come informazione utile, non come
// formalità. Validato non-vuoto/non-solo-whitespace PRIMA dell'invio — il BE lo
// riverifica comunque (DTO + guard service-level).
// =============================================================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome dell'autore, per ricordare a chi arriverà il motivo. */
  autore: string;
  onConfirm: (motivo: string) => Promise<void>;
  isPending?: boolean;
}

export function RespingiDialog({
  open,
  onOpenChange,
  autore,
  onConfirm,
  isPending = false,
}: Props): JSX.Element {
  const t = useTranslations('approvazioneSpese');
  const [motivo, setMotivo] = useState('');
  const [touched, setTouched] = useState(false);

  const motivoValido = motivo.trim().length > 0;

  function chiudi(nextOpen: boolean): void {
    if (!nextOpen) {
      setMotivo('');
      setTouched(false);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={chiudi}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('respingi.titolo')}</DialogTitle>
          <DialogDescription>{t('respingi.descrizione', { autore })}</DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('respingi.motivoLabel')}</span>
          <textarea
            className="h-24 w-full rounded-md border border-input bg-background px-2 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={motivo}
            maxLength={1000}
            autoFocus
            onChange={(e) => setMotivo(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t('respingi.motivoPlaceholder')}
          />
          {touched && !motivoValido && (
            <span className="text-xs text-destructive">{t('respingi.motivoRichiesto')}</span>
          )}
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => chiudi(false)} disabled={isPending}>
            {t('respingi.annulla')}
          </Button>
          <Button
            variant="destructive"
            disabled={!motivoValido || isPending}
            onClick={() => {
              setTouched(true);
              if (motivoValido) void onConfirm(motivo.trim());
            }}
          >
            {t('respingi.conferma')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
