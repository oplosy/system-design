import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection as FlowConnection,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { ApiError, api, type Summary } from './api.ts';
import { BOUNDARY_SPECS, EMPTY_BOUNDARY, boundaryAt, boundaryBoxes } from './boundaries.ts';
import { SketchContext, edgeTypes, nodeTypes, type FlowEdge } from './canvas.tsx';
import { layout } from './layout.ts';
import { DRAG_MIME, Inspector, Palette, ReviewBar, ShapePreview, type AddKind } from './panels.tsx';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const boundaryKind = (k: string) => (k.startsWith('boundary:') && (BOUNDARY_KINDS as readonly string[]).includes(k.slice(9)) ? (k.slice(9) as BoundaryKind) : null);
const isEmpty = (d: Design, id: string) => !d.components.some((c) => c.boundary === id) && !d.boundaries.some((b) => b.parent === id);
/** Boundaries with nothing inside: the only ones whose own position matters. */
const emptyBoundaries = (d: Design) => d.boundaries.filter((b) => isEmpty(d, b.id));
const isAddKind = (k: string): k is AddKind => k === 'note' || k === 'decision' || !!boundaryKind(k) || (COMPONENT_TYPES as readonly string[]).includes(k);

function loadStyle() {
  try {
    return localStorage.getItem('sd-style') !== 'clean';
  } catch {
    return true;
  }
}

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const [designs, setDesigns] = useState<Summary[]>([]);
  const [templates, setTemplates] = useState<Summary[]>([]);
  const [id, setId] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null);
  const [design, setDesign] = useState<Design | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sketch, setSketch] = useState(loadStyle);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const designRef = useRef<Design | null>(null);
  const saveState = useRef({ timer: undefined as number | undefined, pending: false, inFlight: false, dirty: false });
  const canvasRef = useRef<HTMLDivElement>(null);
  const fittedFor = useRef<string | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const commit = useCallback((d: Design | null) => {
    designRef.current = d;
    setDesign(d);
  }, []);

  const flush = useCallback(async () => {
    const s = saveState.current;
    s.pending = false;
    if (s.inFlight) {
      s.dirty = true;
      return;
    }
    const d = designRef.current;
    if (!d) return;
    s.inFlight = true;
    try {
      const saved = await api.save(d);
      if (designRef.current?.id === saved.id) commit({ ...designRef.current, rev: saved.rev });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // shortcut: on a conflict the local edit is dropped, not merged; add a merge if agents and you edit at the same time often.
        s.dirty = false;
        commit(await api.get(d.id));
        setError('This design changed on disk (probably an agent), so it was reloaded. Your last edit was dropped.');
      } else setError(errorText(e));
    } finally {
      s.inFlight = false;
      if (s.dirty) {
        s.dirty = false;
        void flush();
      }
    }
  }, [commit]);

  /** Applies an edit locally right away and saves shortly after. */
  const change = useCallback(
    (fn: (d: Design) => void) => {
      const cur = designRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      try {
        fn(next);
      } catch (e) {
        setError(errorText(e));
        return;
      }
      commit(next);
      const s = saveState.current;
      clearTimeout(s.timer);
      s.pending = true;
      s.timer = window.setTimeout(flush, 350);
    },
    [commit, flush],
  );

  const refreshLists = useCallback(() => {
    api.designs().then(setDesigns).catch((e) => setError(errorText(e)));
    api.templates().then(setTemplates).catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    refreshLists();
    const es = new EventSource('/api/events');
    es.onmessage = async (ev) => {
      const { id: changed } = JSON.parse(ev.data) as { id: string };
      api.designs().then(setDesigns).catch(() => {});
      const cur = designRef.current, s = saveState.current;
      if (!cur || cur.id !== changed || s.pending || s.inFlight) return;
      try {
        const fresh = await api.get(changed);
        if (fresh.rev !== designRef.current?.rev) commit(fresh);
      } catch (e) {
        setError(errorText(e));
      }
    };
    return () => es.close();
  }, [refreshLists, commit]);

  useEffect(() => {
    if (!id && designs.length) setId(designs[0].id);
  }, [id, designs]);

  useEffect(() => {
    if (!id) return;
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    let cancelled = false;
    api
      .get(id)
      .then((d) => {
        if (cancelled) return;
        commit(d);
        setSelected(null);
        const firstUnseen = d.steps.findIndex((s) => !s.seen);
        setViewIndex(firstUnseen >= 0 ? firstUnseen : d.steps.length - 1);
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [id, commit]);

  // New items (from agents or templates) arrive without positions: lay them out once.
  useEffect(() => {
    if (!design) return;
    const items = [...design.components, ...design.notes, ...design.decisions, ...emptyBoundaries(design)];
    if (!items.some((x) => !x.position)) return;
    let cancelled = false;
    layout(design)
      .then((pos) => {
        if (cancelled) return;
        change((d) => {
          for (const x of [...d.components, ...d.notes, ...d.decisions, ...emptyBoundaries(d)]) if (!x.position) x.position = pos.get(x.id);
        });
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [design, change]);

  const firstUnseen = design ? design.steps.findIndex((s) => !s.seen) : -1;
  const maxIndex = design ? (firstUnseen >= 0 ? firstUnseen : design.steps.length - 1) : 0;
  const view = Math.min(viewIndex, maxIndex);
  const current = design?.steps[view];

  const derived = useMemo(() => {
    if (!design || !current) return { nodes: [] as Node[], edges: [] as FlowEdge[], boxes: new Map() as ReturnType<typeof boundaryBoxes> };
    const idx = m.stepIndex(design);
    const visibleStep = (step: string) => idx.get(step)! <= view;
    const reviewing = !current.seen;
    const flags = (step: string) => ({ unseen: reviewing && step === current.id, faded: reviewing && step !== current.id });
    const shown = new Set<string>();
    const node = (id: string, type: 'component' | 'note' | 'decision', position: { x: number; y: number } | undefined, data: object, step: string): Node => {
      shown.add(id);
      return { id, type, position: position ?? { x: 0, y: 0 }, hidden: !position, selected: id === selected, data: { ...data, ...flags(step) } };
    };
    const boxes = boundaryBoxes(design, visibleStep);
    const nodes = [
      // Outer boxes first, so inner ones and every part draw on top of them.
      ...design.boundaries
        .filter((b) => boxes.has(b.id))
        .sort((a, b) => boxes.get(a.id)!.depth - boxes.get(b.id)!.depth)
        .map((b): Node => {
          const box = boxes.get(b.id)!;
          return {
            id: b.id,
            type: 'boundary',
            position: { x: box.x, y: box.y },
            className: 'boundary-node',
            dragHandle: '.boundary-tab',
            connectable: false,
            selected: b.id === selected,
            data: { kind: b.kind, label: b.label, detail: b.detail, w: box.w, h: box.h, ...flags(b.step) },
          };
        }),
      ...design.components.filter((c) => visibleStep(c.step)).map((c) => node(c.id, 'component', c.position, { type: c.type, label: c.label, tech: c.tech }, c.step)),
      ...design.notes.filter((n) => visibleStep(n.step)).map((n) => node(n.id, 'note', n.position, { text: n.text }, n.step)),
      ...design.decisions.filter((x) => visibleStep(x.step)).map((x) => node(x.id, 'decision', x.position, { title: x.title, why: x.why }, x.step)),
    ];
    const both = (a: string, b: string) => shown.has(a) && shown.has(b);
    const link = (id: string, source: string, target: string, step: string): FlowEdge => ({
      id,
      source,
      target,
      type: 'rough',
      selectable: false,
      deletable: false,
      data: { kind: 'link', ...flags(step) },
    });
    const edges: FlowEdge[] = [
      ...design.connections
        .filter((c) => visibleStep(c.step) && both(c.from, c.to))
        .map((c): FlowEdge => ({ id: c.id, source: c.from, target: c.to, type: 'rough', selected: c.id === selected, data: { kind: 'flow', label: c.label, async: c.async, ...flags(c.step) } })),
      ...design.notes.filter((n) => n.attachTo && both(n.attachTo, n.id)).map((n) => link(`link-${n.id}`, n.attachTo!, n.id, n.step)),
      ...design.decisions.flatMap((x) => x.links.filter((l) => both(l, x.id)).map((l) => link(`link-${x.id}-${l}`, l, x.id, x.step))),
    ];
    return { nodes, edges, boxes };
  }, [design, current, view, selected]);

  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => setNodes(derived.nodes), [derived.nodes]);
  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // Re-fit when a design opens or the walkthrough moves to another step, so new items are in view.
  useEffect(() => {
    const key = design && `${design.id}:${view}`;
    if (!key || fittedFor.current === key || !nodes.length || nodes.some((n) => n.hidden)) return;
    fittedFor.current = key;
    setTimeout(() => fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }), 60);
  }, [design, view, nodes, fitView]);

  const add = (kind: AddKind, at?: { x: number; y: number }) => {
    if (!current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = at ?? screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 });
    const bKind = boundaryKind(kind);
    const size = bKind ? EMPTY_BOUNDARY : kind === 'note' ? NOTE_SIZE : kind === 'decision' ? DECISION_SIZE : SHAPES[kind as keyof typeof SHAPES];
    const position = { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2) };
    // Dropping onto a boundary puts the new part (or boundary) inside it.
    const inside = at ? boundaryAt(derived.boxes, center) : undefined;
    const step = current.id;
    let newId: string | null = null;
    change((d) => {
      if (bKind) newId = m.addBoundary(d, { kind: bKind, label: BOUNDARY_SPECS[bKind].name, parent: inside, position, step, reopen: false });
      else if (kind === 'note') newId = m.addNote(d, { text: 'New note', position, step, reopen: false });
      else if (kind === 'decision') newId = m.addDecision(d, { title: 'New decision', why: 'Explain why', links: [], position, step, reopen: false });
      else newId = m.addComponent(d, { type: kind as keyof typeof SHAPES, label: SHAPES[kind as keyof typeof SHAPES].name, boundary: inside, position, step, reopen: false });
    });
    setSelected(newId);
  };

  // Dragging a boundary by its tab carries everything inside it along.
  const carried = useRef(new Map<string, { x: number; y: number }>());
  const onNodeDragStart = (_: unknown, __: Node, dragged: Node[]) => {
    const d = designRef.current;
    carried.current.clear();
    if (!d) return;
    for (const n of dragged) {
      if (n.type !== 'boundary') continue;
      const tree = m.boundaryTree(d, n.id);
      for (const x of nodes) {
        const inTree = x.type === 'boundary' ? tree.has(x.id) : d.components.some((c) => c.id === x.id && c.boundary && tree.has(c.boundary));
        if (inTree) carried.current.set(x.id, { ...x.position });
      }
    }
  };
  const onNodeDrag = (_: unknown, __: Node, dragged: Node[]) => {
    const lead = dragged.find((n) => carried.current.has(n.id));
    if (!lead) return;
    const start = carried.current.get(lead.id)!;
    const dx = lead.position.x - start.x, dy = lead.position.y - start.y;
    setNodes((ns) => ns.map((n) => (carried.current.has(n.id) && !dragged.some((g) => g.id === n.id) ? { ...n, position: { x: carried.current.get(n.id)!.x + dx, y: carried.current.get(n.id)!.y + dy } } : n)));
  };
  const onNodeDragStop = (_: unknown, __: Node, dragged: Node[]) => {
    const moved = new Map(dragged.map((n) => [n.id, n.position]));
    const lead = dragged.find((n) => carried.current.has(n.id));
    const delta = lead ? { x: lead.position.x - carried.current.get(lead.id)!.x, y: lead.position.y - carried.current.get(lead.id)!.y } : null;
    if (delta) for (const [id, p] of carried.current) if (!moved.has(id)) moved.set(id, { x: p.x + delta.x, y: p.y + delta.y });
    const boxes = derived.boxes;
    const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    change((d) => {
      const before = new Set(d.boundaries.filter((b) => !isEmpty(d, b.id)).map((b) => b.id));
      for (const [id, p] of moved) {
        const item = [...d.components, ...d.notes, ...d.decisions, ...d.boundaries].find((x) => x.id === id);
        if (item) item.position = round(p);
      }
      // A part or boundary dragged on its own lands in whichever box it is dropped in.
      for (const n of dragged) {
        if (carried.current.has(n.id) && n !== lead) continue;
        const c = d.components.find((x) => x.id === n.id);
        if (c) {
          const s = SHAPES[c.type];
          c.boundary = boundaryAt(boxes, { x: n.position.x + s.w / 2, y: n.position.y + s.h / 2 });
        }
        const b = d.boundaries.find((x) => x.id === n.id);
        if (b) b.parent = boundaryAt(boxes, { x: n.position.x + 20, y: n.position.y + 20 }, m.boundaryTree(d, b.id));
      }
      // A box that just lost its last member stays where it was instead of jumping.
      for (const b of d.boundaries) {
        const box = boxes.get(b.id);
        if (before.has(b.id) && isEmpty(d, b.id) && box) {
          b.position = { x: box.x, y: box.y };
          b.size = { w: box.w, h: box.h };
        }
      }
    });
    carried.current.clear();
  };

  const onConnect = (c: FlowConnection) => {
    if (!current) return;
    change((d) => {
      const kind = (x: string) =>
        d.components.some((i) => i.id === x) ? 'component' : d.notes.some((i) => i.id === x) ? 'note' : d.decisions.some((i) => i.id === x) ? 'decision' : null;
      const ks = kind(c.source), kt = kind(c.target);
      if (ks === 'component' && kt === 'component') {
        m.connect(d, { from: c.source, to: c.target, step: current.id, reopen: false });
        return;
      }
      const comp = ks === 'component' ? c.source : kt === 'component' ? c.target : null;
      const other = comp === c.source ? c.target : c.source;
      if (!comp) throw new Error('Connect notes and decisions to a component.');
      const note = d.notes.find((n) => n.id === other);
      const dec = d.decisions.find((x) => x.id === other);
      if (note) note.attachTo = comp;
      if (dec && !dec.links.includes(comp)) dec.links.push(comp);
    });
  };

  const remove = (ids: string[]) =>
    change((d) => {
      for (const x of ids) {
        const exists = [...d.components, ...d.connections, ...d.notes, ...d.decisions, ...d.boundaries].some((i) => i.id === x);
        if (exists) m.removeItem(d, x);
      }
    });

  const setStyle = (s: boolean) => {
    setSketch(s);
    try {
      localStorage.setItem('sd-style', s ? 'sketch' : 'clean');
    } catch {
      // Style preference is a convenience; ignore blocked storage.
    }
  };

  const goTo = (i: number) => {
    setSelected(null);
    setViewIndex(Math.max(0, Math.min(i, maxIndex)));
  };

  const seenNext = () => {
    if (!design || !current) return;
    if (current.seen) return goTo(view + 1);
    change((d) => {
      d.steps[view].seen = true;
    });
    setSelected(null);
    setViewIndex(Math.min(view + 1, design.steps.length - 1));
  };

  // ← and → walk the steps while nothing is selected (with a selection, arrows move nodes). Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (creating || e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') setSelected(null);
      if (selected) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seenNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(view - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <SketchContext.Provider value={sketch}>
      <div className="app">
        <header className="topbar">
          <span className="wordmark">
            system<span>/</span>design
          </span>
          {designs.length > 0 && (
            <>
              <span className="crumb-sep">/</span>
              <DesignSwitcher designs={designs} current={id} onPick={setId} />
            </>
          )}
          {design && (
            <span className="doc-meta">
              rev {design.rev} · {design.components.length} parts · {design.decisions.length} decisions
            </span>
          )}
          <div className="spacer" />
          <div className="tabs" role="group" aria-label="Drawing style">
            <button aria-pressed={sketch} onClick={() => setStyle(true)}>
              Sketch
            </button>
            <button aria-pressed={!sketch} onClick={() => setStyle(false)}>
              Clean
            </button>
          </div>
          <span className="vrule" />
          <button
            className="text-btn"
            disabled={!design}
            title="Re-arrange every item automatically"
            onClick={() => {
              fittedFor.current = null;
              change((d) => {
                for (const x of [...d.components, ...d.notes, ...d.decisions, ...d.boundaries]) x.position = undefined;
              });
            }}
          >
            Auto layout
          </button>
          <button className="btn ink" onClick={() => setCreating(true)}>
            New design
          </button>
        </header>

        {design && current ? (
          <div className="workspace">
            <Palette onAdd={(k) => add(k)} />
            <div
              className={`canvas${sketch ? ' sketch' : ''}`}
              ref={canvasRef}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const kind = e.dataTransfer.getData(DRAG_MIME);
                if (isAddKind(kind)) add(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }}
            >
              <ReactFlow
                key={design.id}
                nodes={nodes}
                edges={derived.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeClick={(_, n) => setSelected(n.id)}
                onEdgeClick={(_, e) => e.data?.kind === 'flow' && setSelected(e.id)}
                onPaneClick={() => setSelected(null)}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                elevateNodesOnSelect={false}
                onConnect={onConnect}
                onDelete={({ nodes: ns, edges: es }) => remove([...ns.map((n) => n.id), ...es.filter((e) => e.data?.kind === 'flow').map((e) => e.id)])}
                deleteKeyCode={['Delete', 'Backspace']}
                connectionMode={ConnectionMode.Loose}
                colorMode="system"
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1.2} />
                <Controls showInteractive={false} position="top-left" />
              </ReactFlow>
              <ReviewBar design={design} viewIndex={view} maxIndex={maxIndex} onView={goTo} onSeenNext={seenNext} />
            </div>
            <Inspector design={design} selected={selected} stepId={current.id} change={change} onSelect={setSelected} onDelete={(x) => (remove([x]), setSelected(null))} />
          </div>
        ) : (
          designs.length === 0 && (
            <div className="empty">
              <div className="empty-art" aria-hidden="true">
                <ShapePreview type="client" width={72} height={48} />
                <span className="empty-wire" />
                <ShapePreview type="api-gateway" width={84} height={40} />
                <span className="empty-wire" />
                <ShapePreview type="sql-db" width={64} height={48} />
              </div>
              <h2>No designs yet</h2>
              <p>Walk through a template one step at a time, or start from a blank sheet. Agents can also start one through the MCP server.</p>
              <button className="btn ink lg" onClick={() => setCreating(true)}>
                New design
              </button>
            </div>
          )
        )}

        {creating && (
          <NewDesign
            templates={templates}
            onCancel={() => setCreating(false)}
            onCreated={(d) => {
              setCreating(false);
              refreshLists();
              setId(d.id);
            }}
          />
        )}
        {error && (
          <div className="toast" role="alert">
            <span className="tag signal">Error</span>
            <span className="toast-msg">{error}</span>
            <button className="text-btn" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>
    </SketchContext.Provider>
  );
}

function useDismiss(active: boolean, onDismiss: () => void, ref?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    const onDown = (e: MouseEvent) => ref?.current && !ref.current.contains(e.target as HTMLElement) && onDismiss();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [active, onDismiss, ref]);
}

const pad = (n: number) => String(n).padStart(2, '0');

function DesignSwitcher({ designs, current, onPick }: { designs: Summary[]; current: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const cur = designs.find((d) => d.id === current);
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {cur?.title ?? 'Select a design'}
        {cur?.unseen ? <span className="new-count">{cur.unseen} new</span> : null}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Designs">
          {designs.map((d) => (
            <button
              key={d.id}
              role="option"
              aria-selected={d.id === current}
              className="menu-item"
              onClick={() => {
                onPick(d.id);
                setOpen(false);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{d.title}</span>
                {d.description && <span className="menu-desc">{d.description}</span>}
              </span>
              {d.unseen ? <span className="new-count">{d.unseen} new</span> : <span className="menu-meta">{pad(d.steps)} steps</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewDesign({ templates, onCancel, onCreated }: { templates: Summary[]; onCancel: () => void; onCreated: (d: Design) => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDismiss(true, onCancel);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Give the design a title.');
    if (!/[a-z0-9]/i.test(title)) return setErr('Use at least one letter or digit.');
    setBusy(true);
    try {
      onCreated(await api.create({ id: m.slugify(title), title: title.trim(), template: template || undefined }));
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? 'A design with this name already exists. Try another.' : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const options = [{ id: '', title: 'Blank sheet', description: 'Nothing on it yet. Build it yourself or let an agent fill it in.', steps: 1, unseen: 0 }, ...templates];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-design-title" onSubmit={submit}>
        <header className="dialog-head">
          <span className="tag" id="new-design-title">
            New design
          </span>
          <button type="button" className="text-btn" onClick={onCancel}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <input
          className="title-input"
          autoFocus
          value={title}
          placeholder="Untitled design"
          aria-label="Title"
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            setErr(null);
          }}
        />
        {err && <em className="ed-error">{err}</em>}
        <h3 className="rule-head">Start from</h3>
        <div role="radiogroup" aria-label="Start from">
          {options.map((t) => (
            <button key={t.id || 'blank'} type="button" role="radio" aria-checked={template === t.id} className="choice" onClick={() => setTemplate(t.id)}>
              <span className="radio" aria-hidden="true" />
              <span className="choice-main">
                <strong>{t.title}</strong>
                {t.description && <span>{t.description}</span>}
              </span>
              <span className="menu-meta">{t.id ? `${pad(t.steps)} steps` : '—'}</span>
            </button>
          ))}
        </div>
        <footer className="dialog-foot">
          <button type="button" className="text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn ink" disabled={busy}>
            Create design
          </button>
        </footer>
      </form>
    </div>
  );
}
