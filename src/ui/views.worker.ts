/// <reference lib="webworker" />
import { solveRig } from '../core/rig';
import { targetPose } from '../core/art/pose';
import { buildPaths } from '../core/art/shapes';
import { buildParts3D } from '../core/art/spec3d';
import { projectViews } from '../core/art/views';
import type { MorphotypeGenome } from '../core/genome';

interface Req { key: string; genome: MorphotypeGenome }

/** The side, front and top views of a creature at rest, from its 3D parts (see views.ts). */
self.onmessage = (e: MessageEvent<Req>): void => {
  const { key, genome } = e.data;
  try {
    const rig = solveRig(genome);
    const paths = buildPaths(targetPose(rig, genome, 0, false, { x: 0, y: 0 }), genome, rig, false);
    self.postMessage({ key, views: projectViews(buildParts3D(paths, genome, rig)) });
  } catch (err) {
    self.postMessage({ key, error: err instanceof Error ? err.message : String(err) });
  }
};
