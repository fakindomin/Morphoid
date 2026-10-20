import { useMemo } from 'react';
import type { MorphotypeGenome } from '../core/genome';
import { solveRig, type Rig } from '../core/rig';
import { targetPose } from '../core/art/pose';
import { buildPaths, type SlotPaths } from '../core/art/shapes';
import { analyzePrint, fitPlan, touchIssues, type PrintPlan, type PrintReport } from '../core/print';
import { buildParts3D } from '../core/art/spec3d';
import { touchesOf } from '../core/art/settle';
import { serialize } from '../core/genome';

/** Rest-pose geometry in mm: exactly what gets printed (no breathing, no mouse). */
export function restGeometry(g: MorphotypeGenome): { rig: Rig; paths: SlotPaths } {
  const rig = solveRig(g);
  return { rig, paths: buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false) };
}

const cache = new Map<string, PrintReport>();

export function reportFor(g: MorphotypeGenome, plan: PrintPlan): PrintReport {
  const key = `${serialize(g)}|${plan.printer}|${plan.maxBridge}|${plan.supports}|${[...plan.separate].sort().join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { rig, paths } = restGeometry(g);
  const base = analyzePrint(paths, rig, plan);
  // what settling (art/settle.ts) could not move apart: one entry per pair of kinds (the sides are mirrors)
  const seen = new Set<string>();
  const contacts = touchesOf(buildParts3D(paths, g, rig)).filter((t) => t.depth < 0).map((t) => ({ a: t.a, b: t.b, at: [t.at[0], t.at[1]] as [number, number] }))
    .filter((t) => { const k = [t.a, t.b].map((x) => x.replace(/Far$|Near$/, '')).sort().join(); return !seen.has(k) && !!seen.add(k); });
  const touch = touchIssues(contacts);
  const rep: PrintReport = touch.length
    ? { ...base, issues: [...base.issues, ...touch], touches: contacts, level: base.level === 'green' || base.level === 'blue' ? 'yellow' : base.level }
    : base;
  if (cache.size > 200) cache.clear();
  cache.set(key, rep);
  return rep;
}

export function usePrintReport(g: MorphotypeGenome, plan: PrintPlan): PrintReport {
  return useMemo(() => reportFor(g, plan), [g, plan]);
}

export function fittedPlan(g: MorphotypeGenome, plan: PrintPlan): PrintPlan {
  const { rig, paths } = restGeometry(g);
  return fitPlan(paths, rig, plan);
}
