'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, Button, Card, CardContent } from '@gestionale/ui';
import { useAuth } from '@gestionale/auth-web';

import { ConfirmDialog } from '@/components/aziende/ConfirmDialog';
import { UploadDocumentoForm } from '@/components/documenti/UploadDocumentoForm';
import { messageForError } from '@/lib/error-codes';
import { listAziende } from '@/lib/aziende-api';
import type { Azienda } from '@/lib/aziende-types';
import {
  deleteDocumento,
  downloadDocumento,
  getDocumenti,
  getDocumentiTipi,
  uploadDocumento,
} from '@/lib/documenti-api';
import type {
  Documento,
  DocumentoTipo,
  UploadDocumentoInput,
  VisibilitaDocumento,
} from '@/lib/documenti-types';

// =============================================================================
// documenti/page.tsx — Archivio documenti studio↔cliente (ADR-0044, solo operatore)
// =============================================================================
// Client component (pattern scadenze/comunicazioni). Filtri azienda/tipo/
// visibilità al backend. Nome azienda/tipo risolti client-side con i lookup.
// Upload inline (gated documenti.gestisci). Download blob + soft-delete.
// =============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentiPage(): JSX.Element {
  const t = useTranslations('documenti');
  const locale = useLocale();
  const { permissions } = useAuth();
  const canManage = permissions.includes('documenti.gestisci');

  const [items, setItems] = useState<Documento[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [tipi, setTipi] = useState<DocumentoTipo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [filterAzienda, setFilterAzienda] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterVisibilita, setFilterVisibilita] = useState('');

  const [pendingDelete, setPendingDelete] = useState<Documento | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const SELECT =
    'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const loadReference = useCallback(async (): Promise<void> => {
    const [azs, tps] = await Promise.all([listAziende(), getDocumentiTipi()]);
    setAziende(azs);
    setTipi(tps);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setItems(
        await getDocumenti({
          aziendaId: filterAzienda || undefined,
          tipoId: filterTipo || undefined,
          visibilita: (filterVisibilita || undefined) as VisibilitaDocumento | undefined,
        }),
      );
    } catch (err) {
      setLoadError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  }, [filterAzienda, filterTipo, filterVisibilita]);

  useEffect(() => {
    void loadReference().catch(() => {
      /* best-effort: i select restano vuoti, la lista funziona */
    });
  }, [loadReference]);

  useEffect(() => {
    void load();
  }, [load]);

  const aziendaById = useMemo(() => {
    const m = new Map<string, Azienda>();
    for (const a of aziende) m.set(a.id, a);
    return m;
  }, [aziende]);
  const tipoById = useMemo(() => {
    const m = new Map<string, DocumentoTipo>();
    for (const tp of tipi) m.set(tp.id, tp);
    return m;
  }, [tipi]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );

  async function handleUpload(file: File, input: UploadDocumentoInput): Promise<void> {
    setUploadError(null);
    try {
      await uploadDocumento(file, input);
    } catch (err) {
      setUploadError(messageForError(err));
      return;
    }
    setUploading(false);
    await load();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteDocumento(pendingDelete.id);
    } catch {
      /* l'errore di delete è raro; ricarico comunque */
    }
    setPendingDelete(null);
    setIsDeleting(false);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        {canManage && !uploading && (
          <Button onClick={() => setUploading(true)}>
            <Plus className="h-4 w-4" />
            {t('newDocumento')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.azienda')}
          <select
            className={SELECT}
            value={filterAzienda}
            onChange={(e) => setFilterAzienda(e.target.value)}
          >
            <option value="">{t('filters.all')}</option>
            {aziende.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.tipo')}
          <select
            className={SELECT}
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
          >
            <option value="">{t('filters.all')}</option>
            {tipi.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.visibilita')}
          <select
            className={SELECT}
            value={filterVisibilita}
            onChange={(e) => setFilterVisibilita(e.target.value)}
          >
            <option value="">{t('filters.all')}</option>
            <option value="tutti">{t('visibilita.tutti')}</option>
            <option value="azienda">{t('visibilita.azienda')}</option>
          </select>
        </label>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {uploading && (
        <Card>
          <CardContent className="pt-6">
            {uploadError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}
            <UploadDocumentoForm
              aziende={aziende}
              tipi={tipi}
              onSubmit={handleUpload}
              onCancel={() => {
                setUploading(false);
                setUploadError(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">{t('listEmpty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ul className="divide-y">
            {items.map((d) => {
              const az = aziendaById.get(d.aziendaId);
              const tp = tipoById.get(d.tipoId);
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{d.nomeOriginale}</span>
                  {tp && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {tp.nome}
                    </span>
                  )}
                  {az && <span className="text-xs text-muted-foreground">{az.nome}</span>}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {t(`visibilita.${d.visibilita}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatSize(d.dimensione)}</span>
                  <span className="text-xs text-muted-foreground">
                    {dateFmt.format(new Date(d.createdAt))}
                  </span>
                  <span className="ml-auto flex items-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('download')}
                      onClick={() =>
                        void downloadDocumento(d.id, d.nomeOriginale).catch(() => undefined)
                      }
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('delete')}
                        onClick={() => setPendingDelete(d)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('confirm.title')}
        description={pendingDelete ? t('confirm.body', { nome: pendingDelete.nomeOriginale }) : ''}
        confirmLabel={t('confirm.confirmLabel')}
        cancelLabel={t('confirm.cancelLabel')}
        onConfirm={() => void handleConfirmDelete()}
        isPending={isDeleting}
      />
    </div>
  );
}
