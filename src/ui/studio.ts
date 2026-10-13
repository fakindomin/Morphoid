import { useSyncExternalStore } from 'react';
import { createStudioStore, parse, type StudioState } from '../core';

const initial = (() => {
  try {
    const code = new URLSearchParams(location.search).get('code');
    if (code) {
      const r = parse(code);
      if (r.ok) return r.genome;
    }
  } catch { /* no URL access */ }
  return undefined;
})();

/** App-wide singleton: the genome is the only mutable truth. */
export const studio = createStudioStore(initial);

// Keep ?code= in sync so any URL is a shareable Morphotyp.
studio.subscribe(() => {
  try {
    const url = new URL(location.href);
    url.searchParams.set('code', studio.code());
    history.replaceState(null, '', url);
  } catch { /* ignore */ }
});

export const useStudioState = (): StudioState => useSyncExternalStore(studio.subscribe, studio.getState);

export const newSeed = (): number => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

export const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* ignore */ } },
};
