import {
  PRESETS, SIZE_CLASSES, blockDef, presetGenome, serialize, stepToClass, type EnumField, type Op, type StepField,
} from '../../core';
import { PALETTES } from '../../core/palette';
import { useEffect, useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { SOCKET_TILE, TILE_GROUPS, type TileDef, type TileField } from '../tiles';

const CLASS_LABELS = ['1: Mały', '2: Średni', '3: Duży'];

function Segmented({ items, value, onChange, disabled }: {
  items: { label: string; value: number }[]; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className={`segment${disabled ? ' disabled' : ''}`} role="group">
      {items.map((it) => (
        <button key={it.value} type="button" disabled={disabled}
          className={`seg-pill${it.value === value ? ' active' : ''}`} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Eyes on stalks stand out of the head: they cannot be set deeper. */
const EYES_STALKS = 4;

type Genome = ReturnType<typeof studio.getState>['genome'];

/**
 * Is this control greyed out? Everything about a part that is not there ("Brak"), how deep eyes on stalks sit, which
 * way absent whiskers point, and the teeth of a closed Pysk.
 */
function isOff(tf: TileField, g: Genome): boolean {
  const def = blockDef(tf.block);
  const first = def.fields[0]!;
  if (tf.planned) return true;
  if (def.noneMeansEmpty && tf.field !== first.name && g[tf.block]![first.name] === 0) return true;
  const face = g.face!;
  if (tf.block === 'face' && !tf.control) {
    if (tf.field === 'eyeSet') return face.eyes === EYES_STALKS;
    if (tf.field === 'whiskerDir') return face.whiskers === 0;
    if (tf.field === 'teeth') return face.teeth === 0;
  }
  return false;
}

function FieldControl({ tf }: { tf: TileField }) {
  const { genome } = useStudioState();
  const def = blockDef(tf.block);
  const field = def.fields.find((f) => f.name === tf.field)!;
  const value = genome[tf.block]![tf.field]!;
  const off = isOff(tf, genome);

  let control: JSX.Element;
  if (tf.control === 'mouth') {
    // closed or open: an open Pysk shows its teeth (fangs at first), a closed one has none
    control = (
      <Segmented value={value > 0 ? 1 : 0} items={[{ label: 'Zamknięty', value: 0 }, { label: 'Otwarty', value: 1 }]}
        onChange={(open) => studio.applyOps([{ kind: 'set', block: 'face', field: 'teeth', value: open ? Math.max(1, value) : 0 }])} />
    );
  } else if (field.kind === 'step') {
    control = (
      <Segmented disabled={off} value={stepToClass(value)}
        items={Array.from({ length: SIZE_CLASSES }, (_, c) => ({ label: CLASS_LABELS[c]!, value: c }))}
        onChange={(cls) => studio.applyOps([{ kind: 'size', block: tf.block, field: tf.field, cls }])} />
    );
  } else {
    const f = field as EnumField;
    // the teeth control offers only the kinds of teeth: "none" is the closed Pysk above it
    const skip = (i: number): boolean => tf.block === 'face' && tf.field === 'teeth' && i === 0;
    const order = tf.order ?? f.options.map((_, i) => i);
    control = (
      <Segmented disabled={off} value={value}
        items={order.flatMap((i) => (skip(i) || (f.options[i]!.retired && i !== value) ? [] : [{ label: f.options[i]!.label, value: i }]))}
        onChange={(v) => {
          const ops: Op[] = [{ kind: 'set', block: tf.block, field: tf.field, value: v }];
          // leaving "Brak" must also give a sensible size (class 2), not the zeroed one
          const step = def.fields.find((x): x is StepField => x.kind === 'step');
          if (def.noneMeansEmpty && field === def.fields[0] && value === 0 && v > 0 && step) {
            ops.push({ kind: 'size', block: tf.block, field: step.name, cls: 1 });
          }
          studio.applyOps(ops);
        }} />
    );
  }
  return (
    <div className={off ? 'field off' : 'field'}>
      <div className="control-label">{tf.label}</div>
      {control}
    </div>
  );
}

/** How big a part is, in words that agree with its name (a closed category shows it next to the chosen shape). */
const SIZE_WORDS: Record<string, readonly [string, string, string]> = {
  'snout.reach': ['krótki', 'średni', 'długi'],
  'ears.scale': ['małe', 'średnie', 'duże'],
  'horns.span': ['małe', 'średnie', 'duże'],
  'crest.scale': ['mały', 'średni', 'duży'],
  'head.neckLength': ['krótka', 'średnia', 'długa'],
  'body.length': ['krótki', 'średni', 'długi'],
  'wings.scale': ['małe', 'średnie', 'duże'],
  'legs.length': ['krótkie', 'średnie', 'długie'],
  'hands.length': ['krótkie', 'średnie', 'długie'],
  'tail.length': ['mały', 'średni', 'duży'],
};

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** A closed category's summary: the chosen shape and, when the part is there, how big it is. */
function statusOf(tile: TileDef, g: Genome): string {
  const first = tile.fields[0];
  if (!first) return `Triada ${g.palette!.index! + 1}`;
  const f = blockDef(first.block).fields.find((x) => x.name === first.field)!;
  const wordOf = (tf: TileField): string => SIZE_WORDS[`${tf.block}.${tf.field}`]![stepToClass(g[tf.block]![tf.field]!)]!;
  if (f.kind !== 'enum') return SIZE_WORDS[`${first.block}.${first.field}`] ? cap(wordOf(first)) : CLASS_LABELS[stepToClass(g[first.block]![first.field]!)]!;
  const shape = f.options[g[first.block]![first.field]!]!.label;
  const sized = tile.fields.find((tf) => SIZE_WORDS[`${tf.block}.${tf.field}`] && !isOff(tf, g));
  // the size, unless the shape already says it ("Krótki, krótki")
  return sized && sized !== first && wordOf(sized) !== shape.toLowerCase() ? `${shape}, ${wordOf(sized)}` : shape;
}

function PaletteGrid() {
  const { genome } = useStudioState();
  const cur = genome.palette!.index!;
  return (
    <div className="palette-grid">
      {PALETTES.map((tri, i) => (
        <button key={i} type="button" className={`swatch${i === cur ? ' active' : ''}`} title={`Triada ${i + 1}`}
          onClick={() => studio.applyOps([{ kind: 'set', block: 'palette', field: 'index', value: i }])}>
          {tri.map((c, k) => <span key={k} style={{ background: c }} />)}
        </button>
      ))}
    </div>
  );
}

/** Ready-made animals: one click loads the whole creature, which can then be changed like any other. */
function PresetGrid() {
  const { genome } = useStudioState();
  const code = serialize(genome);
  return (
    <div className="preset-grid">
      {PRESETS.map((p) => (
        <button key={p.id} type="button" className={`preset${serialize(presetGenome(p)) === code ? ' active' : ''}`}
          onClick={() => studio.loadPreset(p)}>{p.name}</button>
      ))}
    </div>
  );
}

/**
 * The creature's parts as categories from head to tail, all closed at first. Opening one closes the one that was open,
 * so the column never grows past the screen; clicking a part on the sketch opens its category and lights it up.
 */
export function LeftColumn({ activeSocket, pick, hotTile, onHoverTile }: {
  activeSocket: string | null;
  /** a body element clicked on the sketch */
  pick: { tile: string; n: number } | null;
  /** a body element hovered on the sketch: its category lights up (and hovering a category lights the sketch) */
  hotTile: string | null;
  onHoverTile: (tile: string | null) => void;
}) {
  const { genome } = useStudioState();
  const [open, setOpen] = useState<string | null>(null);
  const socketTile = activeSocket ? SOCKET_TILE[activeSocket] ?? null : null;
  const hot = socketTile ?? hotTile;
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!socketTile) return;
    setOpen(socketTile);
    refs.current[socketTile]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [socketTile]);
  useEffect(() => {
    if (!pick) return;
    setOpen(pick.tile);
    refs.current[pick.tile]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pick]);
  let n = 0;
  const preset = PRESETS.find((p) => serialize(presetGenome(p)) === serialize(genome));
  return (
    <aside className="column left acc-column">
      <div className="acc-group">
        <p className="acc-group-title">Gotowce</p>
        <section className={`cat${open === 'presets' ? ' open' : ''}`}>
          <button type="button" className="cat-h" aria-expanded={open === 'presets'} onClick={() => setOpen(open === 'presets' ? null : 'presets')}>
            <span className="cat-n">★</span>
            <span className="cat-t">Zwierzęta na start</span>
            <span className="cat-v">{preset?.name ?? 'Własny'}</span>
            <i className="chev" aria-hidden />
          </button>
          {open === 'presets' && <div className="cat-b"><PresetGrid /></div>}
        </section>
      </div>
      {TILE_GROUPS.map((grp) => (
        <div key={grp.title} className="acc-group">
          <p className="acc-group-title">{grp.title}</p>
          {grp.tiles.map((tile) => {
            const on = open === tile.id;
            const num = ++n;
            return (
              <section key={tile.id} ref={(el) => { refs.current[tile.id] = el; }} className={`cat${on ? ' open' : ''}${hot === tile.id ? ' hot' : ''}`}
                onPointerEnter={() => onHoverTile(tile.id)} onPointerLeave={() => onHoverTile(null)}>
                <button type="button" className="cat-h" aria-expanded={on} onClick={() => setOpen(on ? null : tile.id)}>
                  <span className="cat-n">{num}</span>
                  <span className="cat-t">{tile.title}</span>
                  <span className="cat-v">{statusOf(tile, genome)}</span>
                  <i className="chev" aria-hidden />
                </button>
                {on && (
                  <div className="cat-b">
                    {tile.palette ? <PaletteGrid /> : tile.fields.map((tf) => <FieldControl key={`${tf.block}.${tf.field}.${tf.control ?? ''}`} tf={tf} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
