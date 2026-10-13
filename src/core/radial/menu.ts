/**
 * Radial menu (HUD ring) as a PURE state machine: no DOM, no timers.
 * The UI feeds events in and renders `view(state)`; effects (commit / revert)
 * are returned to the caller, which applies them to the store.
 *
 * Zero-Travel Undo
 * ----------------
 * Every click carries `angle` = the pointer's angle around the ring centre.
 * The slice shown NEXT is laid out so that [↩ WSTECZ] is centred exactly on
 * that angle, on the same ring radii => it is guaranteed to be under the
 * cursor, whatever part of the clicked slice was hit. This holds for:
 *   - entering a submenu  : Back = go up one level,
 *   - choosing a leaf     : Back = revert this choice (and return to its level).
 */
import {
  BLOCKS, SIZE_CLASSES, blockDef, setField, setSizeClass, stepToClass,
  type BlockId, type MorphotypeGenome,
} from '../genome';
import type { SocketId } from '../rig';

export type Op =
  | { kind: 'set'; block: BlockId; field: string; value: number }
  | { kind: 'size'; block: BlockId; field: string; cls: number };

export interface MenuNode {
  id: string;
  label: string;
  icon?: string;
  children?: MenuNode[];
  op?: Op;
  /** Applied before `op` when the leaf is chosen (e.g. set type, then size). */
  pre?: Op;
}

export function applyOp(g: MorphotypeGenome, op: Op): MorphotypeGenome {
  return op.kind === 'set' ? setField(g, op.block, op.field, op.value) : setSizeClass(g, op.block, op.field, op.cls);
}

// ---------------------------------------------------------------- tree build

const SIZE_LABELS = ['1: Mały', '2: Średni', '3: Duży'];

const FIELD_LABELS: Record<string, string> = {
  shape: 'KSZTAŁT', foot: 'STOPA', skull: 'CZASZKA', neck: 'FASADA SZYI',
  type: 'RODZAJ', eyes: 'OCZY', teeth: 'ZĘBY', whiskers: 'WĄSY', expression: 'MINA',
  texture: 'FAKTURA', pattern: 'WZÓR', index: 'PALETA',
};

/**
 * Builds the submenu for one genome block straight from the schema.
 *  - "type + size" blocks (ears, horns, wings, tail, ...): TYPE -> SIZE(1..3).
 *    Picking a size also commits the type (`pre`), so a single path = one coherent edit.
 *  - other blocks: one ring entry per field (enum -> options, step -> sizes).
 */
function blockNode(block: BlockId, icon?: string): MenuNode {
  const def = blockDef(block);
  const enums = def.fields.filter((f) => f.kind === 'enum');
  const steps = def.fields.filter((f) => f.kind === 'step');
  const sizeLeaves = (idPrefix: string, field: string, pre?: Op): MenuNode[] =>
    Array.from({ length: SIZE_CLASSES }, (_, c) => ({
      id: `${idPrefix}.size${c}`, label: SIZE_LABELS[c]!, icon: String(c + 1),
      op: { kind: 'size', block, field, cls: c } as Op, ...(pre ? { pre } : {}),
    }));
  const node: MenuNode = { id: block, label: def.label.toUpperCase(), ...(icon ? { icon } : {}), children: [] };

  const first = enums[0];
  if (first && first.kind === 'enum' && enums.length === 1 && steps.length === 1) {
    const step = steps[0]!;
    node.children = first.options.flatMap((o, i) => (o.retired ? [] : [{ o, i }])).map(({ o, i }) => {
      const set: Op = { kind: 'set', block, field: first.name, value: i };
      if (o.id === 'none') {
        return { id: `${block}.${o.id}`, label: o.label.toUpperCase(), op: set };
      }
      return { id: `${block}.${o.id}`, label: o.label.toUpperCase(), children: sizeLeaves(`${block}.${o.id}`, step.name, set) };
    });
    return node;
  }
  node.children = def.fields.map((f): MenuNode => {
    const id = `${block}.${f.name}`;
    if (f.kind === 'step') return { id, label: f.label.toUpperCase(), children: sizeLeaves(id, f.name) };
    return {
      id, label: FIELD_LABELS[f.name] ?? f.name.toUpperCase(),
      children: f.options.flatMap((o, i) => (o.retired ? [] : [{
        id: `${id}.${o.id}`, label: o.label.toUpperCase(), op: { kind: 'set', block, field: f.name, value: i } as Op,
      }])),
    };
  });
  return node;
}

/** What each of the 5 sockets exposes (mirrors the mockup's trees). */
export function treeForSocket(socket: SocketId): MenuNode {
  const make = (title: string, blocks: BlockId[]): MenuNode => ({
    id: `socket.${socket}`, label: title, children: blocks.map((b) => blockNode(b)),
  });
  switch (socket) {
    case 'head': return make('Głowa', ['horns', 'snout', 'ears']);
    case 'chest': return make('Kark / Szyja / Skrzydła', ['head', 'wings', 'crest']);
    case 'tail': return make('Ogon', ['tail']);
    case 'legF': return make('Noga przednia', ['legs']);
    case 'legB': return make('Noga tylna', ['legs']);
  }
}

// ------------------------------------------------------------------ layout

export interface Slice {
  id: string;
  label: string;
  icon?: string;
  isBack: boolean;
  /** centre angle, radians (0 = +x, clockwise on screen since y points down) */
  angle: number;
  start: number;
  end: number;
  node?: MenuNode;
}

export const TWO_PI = Math.PI * 2;
export const normAngle = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

export function layoutSlices(items: readonly MenuNode[], backAngle: number | null): Slice[] {
  const hasBack = backAngle !== null;
  const count = items.length + (hasBack ? 1 : 0);
  if (count === 0) return [];
  // A lone Back button is a compact ~70° wedge under the cursor, not a full ring.
  const span = items.length === 0 ? 1.2 : TWO_PI / count;
  const out: Slice[] = [];
  const mk = (id: string, label: string, angle: number, isBack: boolean, node?: MenuNode, icon?: string): Slice => ({
    id, label, isBack, angle, start: angle - span / 2, end: angle + span / 2, ...(node ? { node } : {}), ...(icon ? { icon } : {}),
  });
  if (hasBack) {
    out.push(mk('back', 'WSTECZ', backAngle, true, undefined, '↩'));
    items.forEach((it, i) => out.push(mk(it.id, it.label, backAngle + span * (i + 1), false, it, it.icon)));
  } else {
    items.forEach((it, i) => out.push(mk(it.id, it.label, -Math.PI / 2 + span * i, false, it, it.icon)));
  }
  return out;
}

/** Which slice contains the pointer? (angle in radians, any range) */
export function hitSlice(slices: readonly Slice[], angle: number): Slice | undefined {
  const a = normAngle(angle);
  return slices.find((s) => {
    const span = s.end - s.start;
    const d = normAngle(a - s.start);
    return d <= span;
  });
}

// ------------------------------------------------------------------ machine

export interface MenuState {
  open: boolean;
  socket: SocketId | null;
  root: MenuNode | null;
  /** nodes entered so far (excluding root) */
  path: MenuNode[];
  /** angle where the Back slice sits; null at depth 0 */
  backAngle: number | null;
  /** after a leaf was chosen: only Back is shown; holds what to revert */
  confirm: { node: MenuNode; backAngle: number } | null;
}

export type MenuEvent =
  | { type: 'open'; socket: SocketId }
  | { type: 'pick'; id: string; angle: number }
  | { type: 'back'; angle: number }
  | { type: 'close' };

export type MenuEffect = { type: 'commit'; ops: Op[] } | { type: 'revert' };

export const closedMenu: MenuState = { open: false, socket: null, root: null, path: [], backAngle: null, confirm: null };

const current = (s: MenuState): MenuNode | null => (s.path.length ? s.path[s.path.length - 1]! : s.root);

export function reduceMenu(state: MenuState, ev: MenuEvent): { state: MenuState; effects: MenuEffect[] } {
  switch (ev.type) {
    case 'open':
      return { state: { open: true, socket: ev.socket, root: treeForSocket(ev.socket), path: [], backAngle: null, confirm: null }, effects: [] };
    case 'close':
      return { state: closedMenu, effects: [] };
    case 'pick': {
      if (!state.open || state.confirm) return { state, effects: [] };
      const node = current(state)?.children?.find((c) => c.id === ev.id);
      if (!node) return { state, effects: [] };
      if (node.children?.length) {
        return { state: { ...state, path: [...state.path, node], backAngle: ev.angle }, effects: [] };
      }
      const ops: Op[] = [];
      if (node.pre) ops.push(node.pre);
      if (node.op) ops.push(node.op);
      return {
        state: { ...state, confirm: { node, backAngle: ev.angle } },
        effects: ops.length ? [{ type: 'commit', ops }] : [],
      };
    }
    case 'back': {
      if (!state.open) return { state, effects: [] };
      if (state.confirm) {
        // undo the choice; stay on the same level, Back stays under the cursor (if depth > 0)
        return {
          state: { ...state, confirm: null, backAngle: state.path.length ? ev.angle : null },
          effects: [{ type: 'revert' }],
        };
      }
      if (state.path.length === 0) return { state: closedMenu, effects: [] };
      const path = state.path.slice(0, -1);
      return { state: { ...state, path, backAngle: path.length ? ev.angle : null }, effects: [] };
    }
  }
}

export interface MenuView { title: string; slices: Slice[] }

export function viewMenu(state: MenuState): MenuView | null {
  if (!state.open) return null;
  if (state.confirm) {
    return { title: state.confirm.node.label, slices: layoutSlices([], state.confirm.backAngle) };
  }
  const node = current(state);
  if (!node) return null;
  return { title: node.label, slices: layoutSlices(node.children ?? [], state.backAngle) };
}

/** Highlight helper for the UI: is this size/type leaf the genome's current value? */
export function isActive(g: MorphotypeGenome, op: Op): boolean {
  const cur = g[op.block]?.[op.field] ?? -1;
  return op.kind === 'set' ? cur === op.value : stepToClass(cur) === op.cls;
}

export { BLOCKS };
