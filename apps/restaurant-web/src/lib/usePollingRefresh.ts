'use client';

import { useEffect, useRef } from 'react';

// =============================================================================
// usePollingRefresh — refetch leggero on-interval + on-focus (PR-2 mappa sala)
// =============================================================================
// La mappa sala deriva lo stato occupato/libero dai conti aperti: senza SSE/
// WebSocket (fuori scope, decision point KDS) l'aggiornamento è a polling
// leggero. Convenzione FE del progetto: nessun react-query/SWR → hook nativo
// (~20 righe) agganciato al `load()` esistente della pagina.
//
// - Interval attivo SOLO a tab visibile (`document.visibilityState`): niente
//   fetch inutili in background.
// - Refetch immediato su `focus` finestra e su `visibilitychange`→visibile
//   (l'utente torna sulla scheda → vuole il dato fresco subito).
// - Cleanup completo su unmount / cambio deps.
//
// `callback` è tenuto in un ref così un cambio d'identità della funzione NON
// ri-sottoscrive interval/listener (nessun reset del timer ad ogni render).
// =============================================================================

interface UsePollingRefreshOptions {
  /** Periodo del tick, ms. Default 20s. */
  intervalMs?: number;
  /** Se false, disattiva del tutto polling e listener. Default true. */
  enabled?: boolean;
}

export function usePollingRefresh(
  callback: () => void,
  { intervalMs = 20_000, enabled = true }: UsePollingRefreshOptions = {},
): void {
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const runIfVisible = (): void => {
      if (document.visibilityState === 'visible') savedCallback.current();
    };
    const onFocus = (): void => savedCallback.current();

    const intervalId = window.setInterval(runIfVisible, intervalMs);
    document.addEventListener('visibilitychange', runIfVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', runIfVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, intervalMs]);
}
