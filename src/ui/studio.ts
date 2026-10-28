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
    // keep the colons readable in the link; only '#' must be escaped
    const params = new URLSearchParams(location.search);
    params.delete('code');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}?code=${studio.code().replace('#', '%23')}${rest ? '&' + rest : ''}${location.hash}`);
  } catch { /* ignore */ }
});

export const useStudioState = (): StudioState => useSyncExternalStore(studio.subscribe, studio.getState);

export const newSeed = (): number => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

export const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* ignore */ } },
};

// The print plan is a per-user preference (not part of the DNA): persist it locally.
const PLAN_KEY = 'morphoid.plan';
try {
  const raw = storage.get(PLAN_KEY);
  if (raw) {
    const plan = JSON.parse(raw) as import('../core/print').PrintPlan;
    if (plan && Array.isArray(plan.separate) && typeof plan.maxBridge === 'number') {
      studio.setPlan({ ...plan, supports: plan.supports ?? 'allowed' });
      studio.setPrinter(plan.printer, typeof plan.ams === 'number' ? plan.ams : 1); // a plan saved before the printer choice: P1S with one AMS
    }
  }
} catch { /* ignore a corrupted value */ }
let lastPlan = studio.getState().plan;
studio.subscribe((s) => {
  if (s.plan !== lastPlan) { lastPlan = s.plan; storage.set(PLAN_KEY, JSON.stringify(s.plan)); }
});

// Names the user gave their creatures: local only, never in the DNA.
const NAMES_KEY = 'morphoid.names';
try {
  const raw = storage.get(NAMES_KEY);
  if (raw) { const names = JSON.parse(raw); if (names && typeof names === 'object') studio.setNames(names as Record<string, string>); }
} catch { /* ignore a corrupted value */ }
let lastNames = studio.getState().names;
studio.subscribe((s) => {
  if (s.names !== lastNames) { lastNames = s.names; storage.set(NAMES_KEY, JSON.stringify(s.names)); }
});
