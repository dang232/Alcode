import React from 'react';

import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useTerminalStore } from '@/stores/useTerminalStore';

const TERMINAL_SESSION_KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;

export const useTerminalSessionKeepalive = (): void => {
  const { terminal } = useRuntimeAPIs();

  React.useEffect(() => {
    if (!terminal.touchSessions) {
      return;
    }
    let inFlight = false;
    const touch = () => {
      if (globalThis.navigator?.onLine === false) return;
      // A hidden tab keeps no PTY visible: skip the sweep and let the next
      // interval retry, instead of churning the server while nobody watches.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Guard overlap: a slow sweep never piles a second sweep behind it.
      if (inFlight) return;
      // One batch per directory: a terminal inside an isolated space is touched in that space.
      const pending: Array<Promise<unknown>> = [];
      for (const [directory, dirState] of useTerminalStore.getState().sessions) {
        const ids: string[] = [];
        for (const tab of dirState.tabs) {
          if (tab.terminalSessionId && tab.lifecycle !== 'exited') ids.push(tab.terminalSessionId);
        }
        if (ids.length > 0) pending.push(terminal.touchSessions?.(ids, directory).catch(() => {}) ?? Promise.resolve());
      }
      if (pending.length === 0) return;
      inFlight = true;
      void Promise.allSettled(pending).then(() => {
        inFlight = false;
      });
    };
    touch();
    const interval = setInterval(touch, TERMINAL_SESSION_KEEPALIVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [terminal]);
};
