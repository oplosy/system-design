import { useCallback, useContext, useRef, useState } from 'react';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type ComponentType } from '../core/schema.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { SketchContext } from './canvas.tsx';
import { ShapeDrawing } from './shape-drawing.tsx';
import { useDismiss } from './menus.tsx';
import { GROUPS, KITS, SHAPES, kitsOf, searchRank, type Kit } from './shapes.ts';

export type AddKind = ComponentType | 'note' | 'decision' | `boundary:${BoundaryKind}`;
export const DRAG_MIME = 'application/x-system-design';

export function ShapePreview({ type, width = 56, height = 38 }: { type: ComponentType; width?: number; height?: number }) {
  const sketch = useContext(SketchContext);
  const spec = SHAPES[type];
  return (
    <svg width={width} height={height} viewBox={`-4 -4 ${spec.w + 8} ${spec.h + 8}`} aria-hidden="true" style={{ flex: 'none' }}>
      <ShapeDrawing type={type} sketch={sketch} seed={7} width={1.1} fixed />
    </svg>
  );
}

export function BoundaryPreview({ kind }: { kind: BoundaryKind }) {
  const sketch = useContext(SketchContext);
  const spec = BOUNDARY_SPECS[kind];
  const color = sketch ? spec.color : 'var(--muted)';
  return (
    <svg width={40} height={26} aria-hidden="true" style={{ flex: 'none' }}>
      <rect x={2} y={3} width={36} height={20} rx={2} style={{ fill: color, fillOpacity: 0.08, stroke: color, strokeWidth: 1.4 }} strokeDasharray={spec.dash && '4 3'} />
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

/** The + beside the sheet; the parts open over the sheet and close again once one is added. */
export function AddMenu({ open, onOpen, onAdd }: { open: boolean; onOpen: (open: boolean) => void; onAdd: (kind: AddKind) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpen(false), [onOpen]);
  useDismiss(open, close, ref);
  return (
    <div className="add" ref={ref}>
      <button className="icon-btn float" aria-expanded={open} aria-label="Add a part" title="Add a part (/)" onClick={() => onOpen(!open)}>
        +
      </button>
      {open && <Palette onAdd={onAdd} />}
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
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
      title="Drag onto the sheet or click"
    >
      <span className="part-shape">{preview}</span>
      <span className="part-name">{name}</span>
      <span className="part-add" aria-hidden="true">
        +
      </span>
    </button>
  );
  // A search looks through every kit; otherwise only the chosen kit, its own groups first.
  const inView = (t: ComponentType) => (terms.length ? searchRank(t, terms) !== undefined : kitsOf(t).includes(kit));
  // Searching puts the closest names first, within a group and between groups; the palette order breaks ties.
  const rank = (t: ComponentType) => searchRank(t, terms) ?? 0;
  const groups = [...GROUPS]
    .sort((a, b) => Number(b.kit === kit) - Number(a.kit === kit))
    .map((g) => ({ ...g, types: COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key && inView(t)).sort((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => (terms.length ? Math.min(...a.types.map(rank), 3) - Math.min(...b.types.map(rank), 3) : 0));
  const boundaries = BOUNDARY_KINDS.filter((k) => (terms.length ? match(`${BOUNDARY_SPECS[k].name} ${k} boundary box group network segment vnet namespace floor`) : BOUNDARY_SPECS[k].kits.includes(kit)));
  const explain = [
    { kind: 'note' as const, name: 'Note', preview: <span className="note-swatch" /> },
    { kind: 'decision' as const, name: 'Decision', preview: <span className="decision-swatch" /> },
  ].filter((x) => match(x.name));
  // Enter adds the closest match.
  const first: AddKind | undefined = groups.find((g) => g.types.length)?.types[0] ?? (boundaries[0] && `boundary:${boundaries[0]}`) ?? explain[0]?.kind;
  return (
    <aside className="palette">
      <div className="palette-top">
        <input
          className="palette-search"
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // The first Esc clears the search; the next one closes the parts.
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            } else if (e.key === 'Enter' && terms.length && first) onAdd(first);
          }}
          placeholder="Search parts"
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
                <h3 className="rule-head">{g.title}</h3>
                {g.types.map((t) => row(t, SHAPES[t].name, <ShapePreview type={t} width={40} height={26} />))}
              </section>
            ),
        )}
        {boundaries.length > 0 && (
          <section>
            <h3 className="rule-head">Boundaries</h3>
            {boundaries.map((k) => row(`boundary:${k}`, BOUNDARY_SPECS[k].name, <BoundaryPreview kind={k} />))}
          </section>
        )}
        {explain.length > 0 && (
          <section>
            <h3 className="rule-head">Annotate</h3>
            {explain.map((x) => row(x.kind, x.name, x.preview))}
          </section>
        )}
        {!groups.some((g) => g.types.length) && !boundaries.length && !explain.length && <p className="quiet pad">No match</p>}
      </div>
    </aside>
  );
}
