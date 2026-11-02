import { useContext, useMemo, useState } from 'react';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type ComponentType } from '../core/schema.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { SketchContext } from './canvas.tsx';
import { GROUPS, KITS, NOTE_COLOR, SHAPES, drawShape, kitsOf, searchText, type Kit } from './shapes.ts';
import { pad } from './format.ts';

export type AddKind = ComponentType | 'note' | 'decision' | `boundary:${BoundaryKind}`;
export const DRAG_MIME = 'application/x-system-design';

export function ShapePreview({ type, width = 56, height = 38 }: { type: ComponentType; width?: number; height?: number }) {
  const sketch = useContext(SketchContext);
  const spec = SHAPES[type];
  const paths = useMemo(() => drawShape(type, sketch, 7), [type, sketch]);
  return (
    <svg width={width} height={height} viewBox={`-4 -4 ${spec.w + 8} ${spec.h + 8}`} aria-hidden="true" style={{ flex: 'none' }}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} vectorEffect="non-scaling-stroke" style={{ stroke: p.stroke, strokeWidth: 1.1, fill: p.fill ?? 'none' }} />
      ))}
    </svg>
  );
}

export function BoundaryPreview({ kind }: { kind: BoundaryKind }) {
  const spec = BOUNDARY_SPECS[kind];
  return (
    <svg width={40} height={26} aria-hidden="true" style={{ flex: 'none' }}>
      <rect x={2} y={3} width={36} height={20} rx={2} style={{ fill: spec.color, fillOpacity: 0.08, stroke: spec.color, strokeWidth: 1.4 }} strokeDasharray={spec.dash && '4 3'} />
    </svg>
  );
}

function savedKit(): Kit {
  try {
    const k = localStorage.getItem('sd-kit');
    return KITS.find((x) => x.key === k)?.key ?? 'system';
  } catch {
    return 'system';
  }
}

export function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
  const [query, setQuery] = useState('');
  const [kit, setKitState] = useState<Kit>(savedKit);
  const setKit = (k: Kit) => {
    setKitState(k);
    try {
      localStorage.setItem('sd-kit', k);
    } catch {
      // The kit choice is a convenience; ignore blocked storage.
    }
  };
  // Every word must appear somewhere in the name, id or keywords ("kafka", "redis cache", "s3").
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
  const row = (kind: AddKind, name: string, preview: React.ReactNode) => (
    <button
      key={kind}
      className="part"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(kind)}
      title={`Add ${name}: drag onto the canvas or click`}
    >
      <span className="part-shape">{preview}</span>
      <span className="part-name">{name}</span>
      <span className="part-add" aria-hidden="true">
        +
      </span>
    </button>
  );
  // A search looks through every kit; otherwise only the chosen kit, its own groups first.
  const inView = (t: ComponentType) => (terms.length ? match(searchText(t)) : kitsOf(t).includes(kit));
  const groups = [...GROUPS]
    .sort((a, b) => Number(b.kit === kit) - Number(a.kit === kit))
    .map((g) => ({ ...g, types: COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key && inView(t)) }));
  const boundaries = BOUNDARY_KINDS.filter((k) => (terms.length ? match(`${BOUNDARY_SPECS[k].name} ${k} boundary box group network segment`) : BOUNDARY_SPECS[k].kits.includes(kit)));
  const explain = [
    { kind: 'note' as const, name: 'Note', preview: <span className="note-swatch" /> },
    { kind: 'decision' as const, name: 'Decision', preview: <span className="decision-swatch" /> },
  ].filter((x) => match(x.name));
  return (
    <aside className="palette">
      <div className="palette-top">
        <input
          className="palette-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder={{ system: 'Search: kafka, redis, s3…', network: 'Search: router, printer, wifi…', software: 'Search: use case, class, state…' }[kit]}
          aria-label="Search parts"
        />
        <div className="seg" role="radiogroup" aria-label="Part kit">
          {KITS.map((k) => (
            <button key={k.key} role="radio" aria-checked={kit === k.key} onClick={() => setKit(k.key)}>
              {k.title}
            </button>
          ))}
        </div>
      </div>
      <div className="palette-scroll">
        {groups.map(
          (g) =>
            g.types.length > 0 && (
              <section key={g.key}>
                <h3 className="rule-head">
                  <span className="swatch-sq" style={{ background: g.color }} />
                  {g.title}
                  <span className="rule-count">{pad(g.types.length)}</span>
                </h3>
                {g.types.map((t) => row(t, SHAPES[t].name, <ShapePreview type={t} width={40} height={26} />))}
              </section>
            ),
        )}
        {boundaries.length > 0 && (
          <section>
            <h3 className="rule-head">
              <span className="swatch-sq hollow" />
              Boundaries
              <span className="rule-count">{pad(boundaries.length)}</span>
            </h3>
            {boundaries.map((k) => row(`boundary:${k}`, BOUNDARY_SPECS[k].name, <BoundaryPreview kind={k} />))}
          </section>
        )}
        {explain.length > 0 && (
          <section>
            <h3 className="rule-head">
              <span className="swatch-sq" style={{ background: NOTE_COLOR }} />
              Annotate
              <span className="rule-count">{pad(explain.length)}</span>
            </h3>
            {explain.map((x) => row(x.kind, x.name, x.preview))}
          </section>
        )}
        {!groups.some((g) => g.types.length) && !boundaries.length && !explain.length && <p className="quiet pad">No part matches “{query}”.</p>}
      </div>
      <p className="palette-foot">Drag onto the sheet or click to add. Drag between items to connect.</p>
    </aside>
  );
}
