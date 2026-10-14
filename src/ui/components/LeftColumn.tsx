import {
  SIZE_CLASSES, blockDef, stepToClass, type EnumField, type Op, type StepField,
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

function FieldControl({ tf }: { tf: TileField }) {
  const { genome } = useStudioState();
  const def = blockDef(tf.block);
  const field = def.fields.find((f) => f.name === tf.field)!;
  const value = genome[tf.block]![tf.field]!;
  const typeIsNone = def.noneMeansEmpty && genome[tf.block]![def.fields[0]!.name] === 0 && field !== def.fields[0];

  let control: JSX.Element;
  if (field.kind === 'step') {
    control = (
      <Segmented disabled={!!typeIsNone} value={stepToClass(value)}
        items={Array.from({ length: SIZE_CLASSES }, (_, c) => ({ label: CLASS_LABELS[c]!, value: c }))}
        onChange={(cls) => studio.applyOps([{ kind: 'size', block: tf.block, field: tf.field, cls }])} />
    );
  } else {
    const f = field as EnumField;
    control = (
      <Segmented disabled={tf.planned} value={value} items={f.options.flatMap((o, i) => (o.retired && i !== value ? [] : [{ label: o.label, value: i }]))}
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
    <>
      <div className="control-label">{tf.label}</div>
      {control}
    </>
  );
}

function statusOf(tile: TileDef, g: ReturnType<typeof studio.getState>['genome']): string {
  const first = tile.fields[0];
  if (!first) return `Triada ${g.palette!.index! + 1}`;
  const f = blockDef(first.block).fields.find((x) => x.name === first.field)!;
  return f.kind === 'enum' ? f.options[g[first.block]![first.field]!]!.label : CLASS_LABELS[stepToClass(g[first.block]![first.field]!)]!;
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

/**
 * The creature's parts as categories from head to tail, all closed at first. Opening one closes the one that was open,
 * so the column never grows past the screen; clicking a part on the sketch opens its category and lights it up.
 */
export function LeftColumn({ activeSocket }: { activeSocket: string | null }) {
  const { genome } = useStudioState();
  const [open, setOpen] = useState<string | null>(null);
  const hot = activeSocket ? SOCKET_TILE[activeSocket] ?? null : null;
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!hot) return;
    setOpen(hot);
    refs.current[hot]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hot]);
  let n = 0;
  return (
    <aside className="column left acc-column">
      {TILE_GROUPS.map((grp) => (
        <div key={grp.title} className="acc-group">
          <p className="acc-group-title">{grp.title}</p>
          {grp.tiles.map((tile) => {
            const on = open === tile.id;
            const num = ++n;
            return (
              <section key={tile.id} ref={(el) => { refs.current[tile.id] = el; }} className={`cat${on ? ' open' : ''}${hot === tile.id ? ' hot' : ''}`}>
                <button type="button" className="cat-h" aria-expanded={on} onClick={() => setOpen(on ? null : tile.id)}>
                  <span className="cat-n">{num}</span>
                  <span className="cat-t">{tile.title}</span>
                  <span className="cat-v">{statusOf(tile, genome)}</span>
                  <i className="chev" aria-hidden />
                </button>
                {on && (
                  <div className="cat-b">
                    {tile.palette ? <PaletteGrid /> : tile.fields.map((tf) => <FieldControl key={`${tf.block}.${tf.field}`} tf={tf} />)}
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
