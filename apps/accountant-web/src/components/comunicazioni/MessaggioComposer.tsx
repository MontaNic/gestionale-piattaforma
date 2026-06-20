'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, Send } from 'lucide-react';

import { Button } from '@gestionale/ui';

// =============================================================================
// MessaggioComposer — invio messaggio in un thread.
// =============================================================================
// Toggle "nota interna" → lato='interno' (mai visibile in ottica cliente).
// Allegato opzionale (≤ 20MB, validato anche dal backend): il file è passato al
// parent che, dopo aver creato il messaggio, lo carica sul messaggio nuovo.
// =============================================================================

const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  disabled?: boolean;
  onSend: (input: { testo: string; lato: 'studio' | 'interno'; file?: File }) => Promise<void>;
}

export function MessaggioComposer({ disabled, onSend }: Props): JSX.Element {
  const t = useTranslations('comunicazioni');
  const [testo, setTesto] = useState('');
  const [interno, setInterno] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null): void {
    if (f && f.size > MAX_BYTES) {
      setLocalError(t('composer.fileTooLarge'));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setLocalError(null);
    setFile(f);
  }

  async function handleSend(): Promise<void> {
    if (testo.trim() === '' || sending) return;
    setSending(true);
    setLocalError(null);
    try {
      await onSend({
        testo: testo.trim(),
        lato: interno ? 'interno' : 'studio',
        file: file ?? undefined,
      });
      setTesto('');
      setFile(null);
      setInterno(false);
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <textarea
        className="h-24 w-full rounded-md border border-input bg-background px-2 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={interno ? t('composer.placeholderInterno') : t('composer.placeholder')}
        value={testo}
        onChange={(e) => setTesto(e.target.value)}
        disabled={disabled || sending}
      />
      {localError && <p className="text-xs text-destructive">{localError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={interno}
            onChange={(e) => setInterno(e.target.checked)}
            disabled={disabled || sending}
          />
          <span>{t('composer.notaInterna')}</span>
        </label>

        <label className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <Paperclip className="h-4 w-4" />
          <span>{file ? file.name : t('composer.allega')}</span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            disabled={disabled || sending}
          />
        </label>

        <Button
          className="ml-auto"
          size="sm"
          onClick={() => void handleSend()}
          disabled={disabled || sending || testo.trim() === ''}
        >
          <Send className="h-4 w-4" />
          {interno ? t('composer.inviaNota') : t('composer.invia')}
        </Button>
      </div>
    </div>
  );
}
