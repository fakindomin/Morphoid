import { PRESETS, blockDef, dimensions as D, presetGenome, serialize, type EnumField, type Op } from '../../core';
import { PALETTES } from '../../core/palette';
import { useEffect, useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { SOCKET_TILE, TILE_GROUPS, type TileDef, type TileField } from '../tiles';


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
    if (tf.field === 'whiskerSize') return face.whiskers === 0;
  }
  if (tf.block === 'coat' && tf.field === 'patternSize') return g.coat!.pattern === 0;
  const plan = g.plan!.type!;
  if (tf.block === 'legs') {
    // an octopus stands on its arms: only their length is left to choose; a fish without legs has no feet either
    if (plan === D.PLAN.octopus) return tf.field !== 'length';
    if (tf.field !== 'count' && D.legPairsOf(plan, g.legs!.count) === 0) return true;
  }
  if (tf.block === 'hands' && (tf.field === 'dir' || tf.field === 'dir2') && D.oneArmPose(plan)) return true;
  return false;
}

/** A control's label: an octopus's leg length is the length of its arms. */
const labelOf = (tf: TileField, g: Genome): string =>
  tf.block === 'legs' && tf.field === 'length' && g.plan!.type === D.PLAN.octopus ? 'Długość macek' : tf.label;

function FieldControl({ tf }: { tf: TileField }) {
  const { genome } = useStudioState();
  const def = blockDef(tf.block);
  const field = def.fields.find((f) => f.name === tf.field)!;
  const value = genome[tf.block]![tf.field]!;
  const off = isOff(tf, genome);

  let control: JSX.Element;
  const plan = genome.plan!.type!;
  if (tf.control === 'legCount') {
    // the real number of legs; picking the plan's own number writes "as the plan" (one creature, one code)
    // (a caterpillar's own prolegs: as many as its length fits, -1 here)
    const cat = plan === D.PLAN.caterpillar, own = cat ? -1 : D.planLegs(plan), shown = cat && !value ? -1 : D.legCountOf(plan, value);
    const counts = plan === D.PLAN.fish ? [0, 2, 4, 6, 8] : cat ? [-1, 2, 4, 6, 8] : [2, 4, 6, 8];
    control = (
      <Segmented disabled={off} value={shown} items={counts.map((c) => ({ label: c > 0 ? String(c) : c ? 'Wszystkie' : 'Brak', value: c }))}
        onChange={(c) => studio.applyOps([{ kind: 'set', block: 'legs', field: 'count', value: c === own ? 0 : D.LEG_COUNTS.indexOf(c as never) }])} />
    );
  } else if (tf.control === 'rightArm') {
    // the right arm's real pose; picking the left arm's pose writes "the same"
    const left = genome.hands!.dir!, f = blockDef('hands').fields.find((x) => x.name === 'dir') as EnumField;
    control = (
      <Segmented disabled={off} value={value ? value - 1 : left} items={f.options.map((o, i) => ({ label: o.label, value: i }))}
        onChange={(v) => studio.applyOps([{ kind: 'set', block: 'hands', field: 'dir2', value: v === left ? 0 : v + 1 }])} />
    );
  } else if (tf.control === 'mouth') {
    // closed or open: an open Pysk shows its teeth (fangs at first), a closed one has none
    control = (
      <Segmented value={value > 0 ? 1 : 0} items={[{ label: 'Zamknięty', value: 0 }, { label: 'Otwarty', value: 1 }]}
        onChange={(open) => studio.applyOps([{ kind: 'set', block: 'face', field: 'teeth', value: open ? Math.max(1, value) : 0 }])} />
    );
  } else if (field.kind === 'step') {
    const sz = sizeOf(tf);
    const level = sz.steps.indexOf(levelStep(sz, value));
    return (
      <label className={`field size-field${off ? ' off' : ''}`}>
        <span className="control-label">{labelOf(tf, genome)}<b>{off ? '' : sz.words[level]}</b></span>
        <input type="range" className={`size-slider levels-${sz.steps.length}`} min={0} max={sz.steps.length - 1} step={1} value={level}
          disabled={off} aria-label={tf.label} aria-valuetext={sz.words[level]}
          onChange={(e) => studio.applyOps([{ kind: 'set', block: tf.block, field: tf.field, value: sz.steps[Number(e.target.value)]! }])} />
      </label>
    );
  } else {
    const f = field as EnumField;
    // the teeth control offers only the kinds of teeth: "none" is the closed Pysk above it
    const skip = (i: number): boolean => tf.block === 'face' && tf.field === 'teeth' && i === 0;
    const order = tf.order ?? f.options.map((_, i) => i);
    control = (
      <Segmented disabled={off} value={value}
        items={order.flatMap((i) => (skip(i) || (f.options[i]!.retired && i !== value) ? [] : [{ label: f.options[i]!.label, value: i }]))}
        // leaving "Brak" gives the part its middle sizes (see setField)
        onChange={(v) => {
          const ops: Op[] = [{ kind: 'set', block: tf.block, field: tf.field, value: v }];
          // a new body plan starts with its own number of legs
          if (tf.block === 'plan') ops.push({ kind: 'set', block: 'legs', field: 'count', value: 0 });
          studio.applyOps(ops);
        }} />
    );
  }
  return (
    <div className={off ? 'field off' : 'field'}>
      <div className="control-label">{labelOf(tf, genome)}</div>
      {control}
    </div>
  );
}

/**
 * Size sliders: six levels for the head and what sits on it (and the neck), three clearly different ones for the
 * body, limbs, tail and pattern. A 3-level slider uses the steps 0, 2 and 5 of the gene's six.
 */
interface SizeScale { steps: readonly number[]; words: readonly string[] }
const SIX = [0, 1, 2, 3, 4, 5], THREE = [0, 2, 5];
const six = (w: string): SizeScale => {
  const [a, b, c, d, e, f] = w.split(' ');
  return { steps: SIX, words: [a!, b!, c!, d!, e!, f!].map((x) => x.replace(/_/g, ' ')) };
};
const three = (w: string): SizeScale => ({ steps: THREE, words: w.split(' ') });
const SIZES: Record<string, SizeScale> = {
  'head.size': six('malutka mała średnia duża bardzo_duża ogromna'),
  'face.eyeSize': six('malutkie małe średnie duże bardzo_duże ogromne'),
  'snout.reach': six('bardzo_krótki krótki średni długi bardzo_długi ogromny'),
  'face.whiskerSize': six('bardzo_krótkie krótkie średnie długie bardzo_długie ogromne'),
  'ears.scale': six('malutkie małe średnie duże bardzo_duże ogromne'),
  'horns.span': six('malutkie małe średnie duże bardzo_duże ogromne'),
  'antennae.length': six('bardzo_krótkie krótkie średnie długie bardzo_długie ogromne'),
  'crest.scale': six('malutki mały średni duży bardzo_duży ogromny'),
  'head.neckLength': six('bardzo_krótka krótka średnia długa bardzo_długa ogromna'),
  'head.neckThick': six('bardzo_cienka cienka średnia gruba bardzo_gruba ogromna'),
  'body.length': three('krótki średni długi'),
  'body.girth': three('smukły średni pękaty'),
  'wings.scale': three('małe średnie duże'),
  'legs.length': three('krótkie średnie długie'),
  'legs.thick': three('cienkie średnie grube'),
  'hands.length': three('krótkie średnie długie'),
  'hands.thick': three('cienkie średnie grube'),
  'tail.length': three('mały średni duży'),
  'coat.patternSize': three('drobne średnie duże'),
};
const sizeOf = (tf: TileField): SizeScale => SIZES[`${tf.block}.${tf.field}`] ?? three('mały średni duży');
/** The slider step a stored step shows as (an old code may hold a step between the three levels). */
const levelStep = (sz: SizeScale, step: number): number =>
  sz.steps.reduce((best, s) => (Math.abs(s - step) < Math.abs(best - step) ? s : best), sz.steps[0]!);
const wordOf = (tf: TileField, g: Genome): string => {
  const sz = sizeOf(tf);
  return sz.words[sz.steps.indexOf(levelStep(sz, g[tf.block]![tf.field]!))]!;
};
const isSize = (tf: TileField): boolean => blockDef(tf.block).fields.find((x) => x.name === tf.field)?.kind === 'step';

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** A closed category's summary: the chosen shape and, when the part is there, how big it is. */
function statusOf(tile: TileDef, g: Genome): string {
  const first = tile.fields[0];
  if (!first) return `Triada ${g.palette!.index! + 1}`;
  const f = blockDef(first.block).fields.find((x) => x.name === first.field)!;
  const sized = tile.fields.filter((tf) => isSize(tf) && !isOff(tf, g));
  if (f.kind !== 'enum') return cap(sized.slice(0, 2).map((tf) => wordOf(tf, g)).join(', ')); // the neck: "Długa, gruba"
  const plan = g.plan!.type!, legs0 = D.legCountOf(plan, g.legs!.count), legs = legs0 - (D.handsTakeFrontLegs(plan, g.hands?.type, legs0 / 2) ? 2 : 0);
  const shape = first.control === 'legCount' ? (plan === D.PLAN.octopus ? 'Macki' : plan === D.PLAN.caterpillar && !legs ? 'Nóżki'
    : legs === 0 ? 'Brak' : `${legs} ${legs < 5 ? 'nogi' : 'nóg'}`)
    : f.options[g[first.block]![first.field]!]!.label;
  const word = sized[0] ? wordOf(sized[0], g) : null;
  // the size, unless the shape already says it ("Krótki, krótki")
  return word && word !== shape.toLowerCase() ? `${shape}, ${word}` : shape;
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
