import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  getNodesBounds,
  useReactFlow,
  type Connection as FlowConnection,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import { toDecisionRecord, toMermaid } from '../core/export.ts';
import { lint } from '../core/lint.ts';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type ComponentType, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { ApiError, api, type Summary } from './api.ts';
import { BOUNDARY_SPECS, EMPTY_BOUNDARY, boundaryAt, boundaryBoxes } from './boundaries.ts';
import { EdgeContext, SketchContext, edgeTypes, nodeTypes, type FlowEdge } from './canvas.tsx';
import type { Pt } from './edges.ts';
import { LAYOUTS, layout, type LayoutKind } from './layout.ts';
import { DRAG_MIME, Dock, FindBox, Inspector, type FlowAt, Palette, PresentBar, ReviewBar, ShapePreview, type AddKind } from './panels.tsx';
import { DECISION_SIZE, GROUP_COLOR, NOTE_COLOR, NOTE_SIZE, SHAPES } from './shapes.ts';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const boundaryKind = (k: string) => (k.startsWith('boundary:') && (BOUNDARY_KINDS as readonly string[]).includes(k.slice(9)) ? (k.slice(9) as BoundaryKind) : null);
const isEmpty = (d: Design, id: string) => !d.components.some((c) => c.boundary === id) && !d.boundaries.some((b) => b.parent === id);
/** Boundaries with nothing inside: the only ones whose own position matters. */
const emptyBoundaries = (d: Design) => d.boundaries.filter((b) => isEmpty(d, b.id));
const isAddKind = (k: string): k is AddKind => k === 'note' || k === 'decision' || !!boundaryKind(k) || (COMPONENT_TYPES as readonly string[]).includes(k);

type Theme = 'system' | 'light' | 'dark';
type Docks = { left: { open: boolean; w: number }; right: { open: boolean; w: number } };
const DOCKS: Docks = { left: { open: true, w: 248 }, right: { open: true, w: 352 } };
const DOCK_LIMITS = { left: [200, 420], right: [280, 600] } as const;
/** Gap between a floating panel and the window edge. */
const GAP = 12;

type Editing = { id: string; at: Pt; value: string; multiline: boolean };

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadStyle() {
  try {
    return localStorage.getItem('sd-style') !== 'clean';
  } catch {
    return true;
  }
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('sd-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function loadDocks(): Docks {
  try {
    const d = JSON.parse(localStorage.getItem('sd-docks') ?? 'null') as Docks | null;
    const side = (k: keyof Docks) => ({
      open: typeof d?.[k]?.open === 'boolean' ? d[k].open : DOCKS[k].open,
      w: Number.isFinite(d?.[k]?.w) ? Math.min(Math.max(d![k].w, DOCK_LIMITS[k][0]), DOCK_LIMITS[k][1]) : DOCKS[k].w,
    });
    return { left: side('left'), right: side('right') };
  } catch {
    return DOCKS;
  }
}

/** Saves a view preference; blocked storage only loses the convenience. */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
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
  const [diff, setDiff] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [flow, setFlow] = useState<FlowAt | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [docks, setDocks] = useState<Docks>(loadDocks);
  const designRef = useRef<Design | null>(null);
  const saveState = useRef({ timer: undefined as number | undefined, pending: false, inFlight: false, dirty: false });
  // Undo history of whole designs. It restarts whenever the design is replaced from disk.
  const hist = useRef({ past: [] as Design[], future: [] as Design[], at: 0 });
  const clip = useRef<{ items: m.Clip; pastes: number } | null>(null);
  const pendingSelect = useRef<Set<string> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const fittedFor = useRef<string | null>(null);
  const { screenToFlowPosition, fitView, getNodes, getInternalNode } = useReactFlow();
  // Floating panels cover the canvas edges, so fitting leaves room for them, the top bar and the review bar.
  const inset = (k: keyof Docks) => (docks[k].open && !presenting ? docks[k].w + GAP : 0);
  const fitOpts = useRef<FitViewOptions>({});
  fitOpts.current = {
    padding: { left: `${inset('left') + 40}px`, right: `${inset('right') + 40}px`, top: presenting ? '40px' : '84px', bottom: '120px' },
    duration: 300,
    maxZoom: 1.2,
  };

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    remember('sd-theme', t);
  };
  const updateDocks = (fn: (d: Docks) => Docks) =>
    setDocks((d) => {
      const next = fn(d);
      remember('sd-docks', JSON.stringify(next));
      return next;
    });
  const toggleDock = (k: keyof Docks) => updateDocks((d) => ({ ...d, [k]: { ...d[k], open: !d[k].open } }));
  const resizeDock = (k: keyof Docks, w: number) =>
    updateDocks((d) => ({ ...d, [k]: { ...d[k], w: Math.round(Math.min(Math.max(w, DOCK_LIMITS[k][0]), DOCK_LIMITS[k][1])) } }));

  const commit = useCallback((d: Design | null, { fresh = false } = {}) => {
    designRef.current = d;
    setDesign(d);
    if (fresh) hist.current = { past: [], future: [], at: 0 };
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
        commit(await api.get(d.id), { fresh: true });
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

  const schedule = useCallback(() => {
    const s = saveState.current;
    clearTimeout(s.timer);
    s.pending = true;
    s.timer = window.setTimeout(flush, 350);
  }, [flush]);

  /** Applies an edit locally right away and saves shortly after. `record: false` keeps it out of undo (automatic layout). */
  const change = useCallback(
    (fn: (d: Design) => void, { record = true } = {}) => {
      const cur = designRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      try {
        fn(next);
      } catch (e) {
        setError(errorText(e));
        return;
      }
      if (record) {
        const h = hist.current, now = Date.now();
        // Edits in quick succession (typing, one drag) undo as one.
        if (now - h.at > 600) h.past = [...h.past.slice(-99), cur];
        h.at = now;
        h.future = [];
      }
      commit(next);
      schedule();
    },
    [commit, schedule],
  );

  const undo = (back: boolean) => {
    const h = hist.current, cur = designRef.current;
    const from = back ? h.past : h.future;
    if (!cur || !from.length) return;
    (back ? h.future : h.past).push(cur);
    const snap = from.pop()!;
    h.at = 0;
    // Keep the newest revision so the save is not taken for a stale write.
    commit({ ...snap, rev: cur.rev });
    schedule();
    setSelected(null);
  };

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
        if (fresh.rev !== designRef.current?.rev) commit(fresh, { fresh: true });
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
        commit(d, { fresh: true });
        setSelected(null);
        setFlow(null);
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
        change(
          (d) => {
            for (const x of [...d.components, ...d.notes, ...d.decisions, ...emptyBoundaries(d)]) if (!x.position) x.position = pos.get(x.id);
          },
          { record: false },
        );
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
    // Reviewing, the diff view and presenting all put this step's items in front; the diff view also outlines them.
    const focus = reviewing || diff || presenting;
    // A playing flow dims everything off its path and numbers its hops.
    const playing = flow && design.flows.find((f) => f.id === flow.id && visibleStep(f.step));
    const onPath = new Set(playing?.path);
    const hops = new Map<string, number[]>();
    let hopOn: string | undefined;
    playing?.path.slice(1).forEach((to, i) => {
      const c = m.hopConnection(design, playing.path[i], to);
      if (!c) return;
      hops.set(c.id, [...(hops.get(c.id) ?? []), i + 1]);
      if (i === flow!.at) hopOn = c.id;
    });
    // The diff also outlines what this step changed and draws what it removed as ghosts.
    const changed = new Set(current.changed?.map((c) => c.id));
    const flags = (step: string, id: string) => ({
      unseen: reviewing && step === current.id,
      faded: playing ? !onPath.has(id) && !hops.has(id) : focus && step !== current.id && !changed.has(id),
      added: diff && step === current.id,
      changed: diff && changed.has(id),
    });
    const issues = new Map<string, string[]>();
    if (!presenting) {
      const seen = <T extends { step: string }>(xs: T[]) => xs.filter((x) => visibleStep(x.step));
      const now = { ...design, components: seen(design.components), connections: seen(design.connections), decisions: seen(design.decisions), boundaries: seen(design.boundaries) };
      for (const i of lint(now)) issues.set(i.id, [...(issues.get(i.id) ?? []), i.message]);
    }
    const open = new Map<string, number>();
    for (const c of design.comments) if (c.target && c.by === 'reviewer' && !c.resolved) open.set(c.target, (open.get(c.target) ?? 0) + 1);
    const shown = new Set<string>();
    const node = (id: string, type: 'component' | 'note' | 'decision', position: { x: number; y: number } | undefined, data: object, step: string): Node => {
      shown.add(id);
      return { id, type, position: position ?? { x: 0, y: 0 }, hidden: !position, selected: id === selected, data: { ...data, ...flags(step, id), comments: open.get(id), issues: issues.get(id) } };
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
            data: { kind: b.kind, label: b.label, detail: b.detail, w: box.w, h: box.h, ...flags(b.step, b.id) },
          };
        }),
      ...(diff ? current.removed ?? [] : []).flatMap((r): Node[] =>
        r.type && r.position
          ? [{ id: `ghost-${r.id}`, type: 'component', position: r.position, selectable: false, draggable: false, connectable: false, deletable: false, data: { type: r.type, label: r.label, removed: true, unseen: false, faded: false } }]
          : [],
      ),
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
      data: { kind: 'link', ...flags(step, id) },
    });
    const edges: FlowEdge[] = [
      ...design.connections
        .filter((c) => visibleStep(c.step) && both(c.from, c.to))
        .map(
          (c): FlowEdge => ({
            id: c.id,
            source: c.from,
            target: c.to,
            type: 'rough',
            selected: c.id === selected,
            data: { kind: 'flow', label: c.label, async: c.async, relation: c.kind, route: c.route, bend: c.bend, hops: hops.get(c.id), hopOn: c.id === hopOn, ...flags(c.step, c.id) },
          }),
        ),
      ...design.notes.filter((n) => n.attachTo && both(n.attachTo, n.id)).map((n) => link(`link-${n.id}`, n.attachTo!, n.id, n.step)),
      ...design.decisions.flatMap((x) => x.links.filter((l) => both(l, x.id)).map((l) => link(`link-${x.id}-${l}`, l, x.id, x.step))),
    ];
    return { nodes, edges, boxes };
  }, [design, current, view, selected, diff, presenting, flow]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const lastSelected = useRef(selected);
  // Rebuild nodes from the design, keeping a multi-selection (shift-drag or ctrl-click) across edits.
  useEffect(() => {
    const keep = lastSelected.current === selected;
    lastSelected.current = selected;
    const pending = pendingSelect.current;
    if (pending && derived.nodes.some((n) => pending.has(n.id))) pendingSelect.current = null;
    setNodes((prev) => {
      if (pending) return derived.nodes.map((n) => ({ ...n, selected: pending.has(n.id) }));
      if (!keep) return derived.nodes;
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return derived.nodes.map((n) => (sel.has(n.id) && !n.selected ? { ...n, selected: true } : n));
    });
  }, [derived.nodes, selected]);
  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // Re-fit when a design opens, the walkthrough moves to another step, or presenting starts or ends.
  useEffect(() => {
    const key = design && `${design.id}:${view}:${presenting}`;
    if (!key || fittedFor.current === key || !nodes.length || nodes.some((n) => n.hidden)) return;
    fittedFor.current = key;
    // fitView skips nodes React Flow has not measured yet, so wait until every shown node has a size.
    const fit = (tries: number) => {
      const ready = getNodes().every((n) => n.hidden || getInternalNode(n.id)?.measured.width);
      if (!ready && tries > 0) return void setTimeout(() => fit(tries - 1), 50);
      void fitView(fitOpts.current);
    };
    // Entering full screen resizes the canvas a moment later.
    setTimeout(() => fit(40), presenting ? 250 : 60);
  }, [design, view, nodes, fitView, getNodes, getInternalNode, presenting]);

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
    // Notes and decisions about the parts that move travel with them.
    for (const x of nodes) {
      const note = d.notes.find((i) => i.id === x.id), dec = d.decisions.find((i) => i.id === x.id);
      const along = note ? !!note.attachTo && carried.current.has(note.attachTo) : !!dec?.links.length && dec.links.every((l) => carried.current.has(l));
      if (along && !dragged.some((g) => g.id === x.id)) carried.current.set(x.id, { ...x.position });
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

  const selectedIds = () => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    return ids.length ? ids : selected ? [selected] : [];
  };
  const pasteClip = (c: { items: m.Clip; pastes: number }) => {
    if (!current) return;
    c.pastes++;
    let ids: string[] = [];
    change((d) => {
      ids = m.pasteItems(d, c.items, { step: current.id, offset: 40 * c.pastes });
    });
    pendingSelect.current = new Set(ids);
    setSelected(ids.length === 1 ? ids[0] : null);
  };
  const copy = () => {
    const d = designRef.current, ids = selectedIds();
    if (!d || !ids.length) return false;
    clip.current = { items: m.copyItems(d, ids), pastes: 0 };
    return true;
  };
  const duplicate = () => {
    const d = designRef.current, ids = selectedIds();
    if (d && ids.length) pasteClip({ items: m.copyItems(d, ids), pastes: 0 });
  };

  /** Opens the in-place editor for an item's name, a note's text or a connection's label. */
  const startEdit = (id: string, at: Pt) => {
    const d = designRef.current;
    if (!d || presenting) return;
    const c = d.components.find((x) => x.id === id) ?? d.boundaries.find((x) => x.id === id);
    const note = d.notes.find((x) => x.id === id), dec = d.decisions.find((x) => x.id === id), conn = d.connections.find((x) => x.id === id);
    const value = c?.label ?? note?.text ?? dec?.title ?? (conn && (conn.label ?? ''));
    if (value !== undefined) setEditing({ id, at, value, multiline: !!note || !!dec });
  };
  const finishEdit = (value: string | null) => {
    const e = editing;
    setEditing(null);
    if (!e || value === null || value.trim() === e.value.trim()) return;
    const v = value.trim();
    const d = designRef.current;
    // Names, notes and titles can't be empty; a connection label can.
    if (!v && !d?.connections.some((x) => x.id === e.id)) return;
    change((x) => {
      const conn = x.connections.find((i) => i.id === e.id);
      if (conn) conn.label = v || undefined;
      const c = x.components.find((i) => i.id === e.id) ?? x.boundaries.find((i) => i.id === e.id);
      if (c) c.label = v;
      const note = x.notes.find((i) => i.id === e.id);
      if (note) note.text = v;
      const dec = x.decisions.find((i) => i.id === e.id);
      if (dec) dec.title = v;
    });
  };
  const edgeActions = {
    locked: presenting,
    onBend: (id: string, bend: number | undefined) =>
      change((d) => {
        const c = d.connections.find((x) => x.id === id);
        if (c) c.bend = bend;
      }),
    onEditLabel: startEdit,
    onDelete: (id: string) => {
      remove([id]);
      setSelected(null);
    },
  };

  /** Re-arranges the whole sheet, or only the selected items (a selected boundary brings what it holds). */
  const arrange = (kind: LayoutKind, selectionOnly: boolean) => {
    const d0 = designRef.current;
    if (!d0) return;
    let only: { ids: Set<string>; at: Map<string, { x: number; y: number }> } | undefined;
    if (selectionOnly) {
      const picked = new Set(getNodes().filter((n) => n.selected).map((n) => n.id));
      const boxes = new Set([...picked].filter((id) => d0.boundaries.some((b) => b.id === id)).flatMap((id) => [...m.boundaryTree(d0, id)]));
      const ids = new Set([
        ...[...d0.notes, ...d0.decisions].filter((x) => picked.has(x.id)).map((x) => x.id),
        ...d0.components.filter((c) => picked.has(c.id) || (c.boundary && boxes.has(c.boundary))).map((c) => c.id),
      ]);
      const at = new Map([...d0.components, ...d0.notes, ...d0.decisions].filter((x) => x.position).map((x) => [x.id, x.position!]));
      only = { ids, at };
    }
    layout(d0, kind, only)
      .then((pos) => {
        if (!only) fittedFor.current = null;
        change((d) => {
          for (const x of [...d.components, ...d.notes, ...d.decisions, ...d.boundaries]) if (pos.has(x.id)) x.position = pos.get(x.id);
          // Flow draws right-angled lines; the other layouts keep each line as it was. Pushed-aside items keep theirs.
          const laid = only?.ids ?? pos;
          if (kind === 'flow')
            for (const c of d.connections)
              if (laid.has(c.from) && laid.has(c.to)) {
                c.route = 'elbow';
                c.bend = undefined;
              }
        });
      })
      .catch((e) => setError(errorText(e)));
  };

  const present = (on: boolean) => {
    setPresenting(on);
    setSelected(null);
    setEditing(null);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  // While presenting, re-fit whenever the canvas changes size (panels hide, full screen kicks in).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !presenting) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => fitView(fitOpts.current), 80);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [presenting, fitView]);
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setPresenting(false);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const exportAs = async (kind: 'png' | 'svg' | 'mermaid' | 'decisions') => {
    if (!design) return;
    if (kind === 'mermaid') return downloadText(toMermaid(design), `${design.id}.mmd`);
    if (kind === 'decisions') return downloadText(toDecisionRecord(design), `${design.id}-decisions.md`);
    const el = canvasRef.current?.querySelector<HTMLElement>('.react-flow__viewport');
    const shown = getNodes().filter((n) => !n.hidden);
    if (!el || !shown.length) return setError('Nothing on the sheet to export.');
    const b = getNodesBounds(shown);
    // Room around the parts for arcs and labels that reach past them.
    const pad = 48, width = Math.ceil(b.width + 2 * pad), height = Math.ceil(b.height + 2 * pad);
    const options = {
      width,
      height,
      backgroundColor: getComputedStyle(canvasRef.current!).getPropertyValue('--canvas').trim(),
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)` },
      // Leave out editing aids and review markers: the image is for docs, not for review.
      filter: (n: HTMLElement) => !['inline-edit', 'bend-handle', 'unseen-dot', 'comment-badge', 'lint-badge'].some((c) => n.classList?.contains(c)),
    };
    try {
      download(kind === 'png' ? await toPng(el, { ...options, pixelRatio: 2 }) : await toSvg(el, options), `${design.id}.${kind}`);
    } catch (e) {
      setError(`Export failed: ${errorText(e)}`);
    }
  };

  const findPick = (id: string) => {
    const d = designRef.current;
    const conn = d?.connections.find((c) => c.id === id);
    setSelected(id);
    fitView({ nodes: conn ? [{ id: conn.from }, { id: conn.to }] : [{ id }], duration: 300, maxZoom: 1.2, padding: 0.6 });
  };

  const requestChanges = (text: string) => {
    if (!design || !current) return;
    const wasSeen = current.seen;
    change((d) => m.requestChanges(d, current.id, text));
    setSelected(null);
    if (!wasSeen) setViewIndex(Math.min(view + 1, design.steps.length - 1));
  };

  const setStyle = (s: boolean) => {
    setSketch(s);
    remember('sd-style', s ? 'sketch' : 'clean');
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
      if (creating) return;
      if (presenting) {
        if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) goTo(view + 1);
        else if (['ArrowLeft', 'PageUp'].includes(e.key)) goTo(view - 1);
        else if (e.key === 'Escape') present(false);
        else return;
        e.preventDefault();
        return;
      }
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 'f' && design) {
        e.preventDefault();
        findRef.current?.focus();
        return;
      }
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (mod) {
        if (key === 'z') undo(!e.shiftKey);
        else if (key === 'y') undo(false);
        else if (key === 'd') duplicate();
        else if (key === 'v' && clip.current) pasteClip(clip.current);
        else if (key === 'x' && copy()) {
          remove(selectedIds());
          setSelected(null);
        } else if (!(key === 'c' && copy())) return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
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

  const icon = (d: string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const dockToggle = (k: keyof Docks) => (
    <button
      className="icon-btn"
      aria-pressed={docks[k].open}
      onClick={() => toggleDock(k)}
      title={`${docks[k].open ? 'Hide' : 'Show'} the ${k === 'left' ? 'parts' : 'details'} panel`}
      aria-label={`${k === 'left' ? 'Parts' : 'Details'} panel`}
    >
      {icon(k === 'left' ? 'M2.5 3.5h11v9h-11zM6.5 3.5v9' : 'M2.5 3.5h11v9h-11zM9.5 3.5v9')}
    </button>
  );

  return (
    <SketchContext.Provider value={sketch}>
      <div
        className={`app${presenting ? ' presenting' : ''}`}
        style={{ '--left': `${inset('left')}px`, '--right': `${inset('right')}px` } as React.CSSProperties}
      >
        <header className="topbar">
          <div className="bar">
            {design && dockToggle('left')}
            <span className="wordmark">
              system<span>/</span>design
            </span>
            {designs.length > 0 && <DesignSwitcher designs={designs} current={id} onPick={setId} meta={design ? `rev ${design.rev} · ${design.components.length} parts · ${design.decisions.length} decisions` : undefined} />}
          </div>
          {design && (
            <FindBox design={design} visible={nodes.filter((n) => !n.hidden).map((n) => n.id).concat(derived.edges.map((e) => e.id))} onPick={findPick} inputRef={findRef} />
          )}
          <div className="bar">
            <button className="icon-btn" disabled={!hist.current.past.length} onClick={() => undo(true)} title="Undo (Ctrl+Z)" aria-label="Undo">
              {icon('M5.5 3 2.5 6l3 3M3 6h6.5a4 4 0 0 1 0 8H7')}
            </button>
            <button className="icon-btn" disabled={!hist.current.future.length} onClick={() => undo(false)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              {icon('M10.5 3l3 3-3 3M13 6H6.5a4 4 0 0 0 0 8H9')}
            </button>
            <span className="vrule" />
            <LayoutMenu disabled={!design} selected={nodes.filter((n) => n.selected).length} onPick={arrange} />
            <ExportMenu disabled={!design} onPick={exportAs} />
            <button className="text-btn" disabled={!design} onClick={() => present(true)} title="Walk through the steps full screen">
              Present
            </button>
            <span className="vrule" />
            <AppearanceMenu sketch={sketch} onSketch={setStyle} theme={theme} onTheme={setTheme} icon={icon} />
            {design && dockToggle('right')}
            <button className="btn ink" onClick={() => setCreating(true)}>
              New design
            </button>
          </div>
        </header>

        {design && current ? (
          <div className="workspace">
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
              <EdgeContext.Provider value={edgeActions}>
                <ReactFlow
                  key={design.id}
                  nodes={nodes}
                  edges={derived.edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={(e, n) => !(e.shiftKey || e.ctrlKey || e.metaKey) && setSelected(n.id)}
                  onEdgeClick={(_, e) => e.data?.kind === 'flow' && setSelected(e.id)}
                  onNodeDoubleClick={(e, n) => startEdit(n.id, screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
                  onEdgeDoubleClick={(e, ed) => ed.data?.kind === 'flow' && startEdit(ed.id, screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
                  onPaneClick={() => setSelected(null)}
                  onNodeDragStart={onNodeDragStart}
                  onNodeDrag={onNodeDrag}
                  onNodeDragStop={onNodeDragStop}
                  elevateNodesOnSelect={false}
                  onConnect={onConnect}
                  onDelete={({ nodes: ns, edges: es }) => remove([...ns.map((n) => n.id), ...es.filter((e) => e.data?.kind === 'flow').map((e) => e.id)])}
                  deleteKeyCode={presenting ? null : ['Delete', 'Backspace']}
                  multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
                  nodesDraggable={!presenting}
                  nodesConnectable={!presenting}
                  elementsSelectable={!presenting}
                  zoomOnDoubleClick={false}
                  connectionMode={ConnectionMode.Loose}
                  colorMode={theme}
                  minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={20} size={1.2} />
                  {!presenting && <Controls showInteractive={false} position="top-left" fitViewOptions={fitOpts.current} />}
                  {!presenting && (
                    <MiniMap
                      position="top-right"
                      pannable
                      zoomable
                      ariaLabel="Overview"
                      style={{ width: 160, height: 104 }}
                      nodeColor={(n) =>
                        n.type === 'component' ? GROUP_COLOR[SHAPES[(n.data as { type: ComponentType }).type].group] : n.type === 'note' ? NOTE_COLOR : n.type === 'decision' ? 'var(--decision)' : 'transparent'
                      }
                      nodeStrokeColor={(n) => (n.type === 'boundary' ? BOUNDARY_SPECS[(n.data as { kind: BoundaryKind }).kind].color : 'transparent')}
                      nodeStrokeWidth={3}
                    />
                  )}
                  <ViewportPortal>{editing && <InlineEdit key={editing.id} {...editing} onDone={finishEdit} />}</ViewportPortal>
                </ReactFlow>
              </EdgeContext.Provider>
              {presenting ? (
                <PresentBar design={design} viewIndex={view} maxIndex={maxIndex} onView={goTo} onExit={() => present(false)} />
              ) : (
                <ReviewBar
                  design={design}
                  viewIndex={view}
                  maxIndex={maxIndex}
                  onView={goTo}
                  onSeenNext={seenNext}
                  onRequestChanges={requestChanges}
                  diff={diff}
                  onDiff={() => setDiff((x) => !x)}
                />
              )}
            </div>
            {docks.left.open && (
              <Dock side="left" width={docks.left.w} onResize={(w) => resizeDock('left', w)} onReset={() => resizeDock('left', DOCKS.left.w)}>
                <Palette onAdd={(k) => add(k)} />
              </Dock>
            )}
            {docks.right.open && (
              <Dock side="right" width={docks.right.w} onResize={(w) => resizeDock('right', w)} onReset={() => resizeDock('right', DOCKS.right.w)}>
                <Inspector design={design} selected={selected} stepId={current.id} flow={flow} onFlow={setFlow} change={change} onSelect={setSelected} onDelete={(x) => (remove([x]), setSelected(null))} />
              </Dock>
            )}
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

/** Text box over the canvas for renaming in place. Enter or leaving it saves; Esc cancels; Shift+Enter adds a line. */
function InlineEdit({ at, value, multiline, onDone }: Editing & { onDone: (value: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  const props = {
    autoFocus: true,
    value: v,
    'aria-label': 'Edit text',
    className: 'inline-edit nodrag nopan nowheel',
    style: { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
    onBlur: () => finish(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        finish(v);
      }
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input {...props} />;
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { key: T; title: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} onClick={() => onPick(o.key)}>
          {o.title}
        </button>
      ))}
    </div>
  );
}

const THEMES = [
  { key: 'light', title: 'Light' },
  { key: 'dark', title: 'Dark' },
  { key: 'system', title: 'System' },
] as const;
const STYLES = [
  { key: 'sketch', title: 'Sketch' },
  { key: 'clean', title: 'Clean' },
] as const;

function AppearanceMenu({
  sketch,
  onSketch,
  theme,
  onTheme,
  icon,
}: {
  sketch: boolean;
  onSketch: (s: boolean) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  icon: (d: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="switcher" ref={ref}>
      <button className="icon-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Appearance: theme and drawing style" aria-label="Appearance">
        {icon('M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.85.85M11.05 11.05l.85.85M4.1 11.9l.85-.85M11.05 4.95l.85-.85M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z')}
      </button>
      {open && (
        <div className="menu menu-right menu-pad" role="dialog" aria-label="Appearance">
          <span className="field-label">Theme</span>
          <Seg label="Theme" value={theme} options={THEMES} onPick={onTheme} />
          <span className="field-label">Drawing style</span>
          <Seg label="Drawing style" value={sketch ? 'sketch' : 'clean'} options={STYLES} onPick={(v) => onSketch(v === 'sketch')} />
          <p className="menu-note">Sketch draws hand-made lines like a whiteboard; Clean draws crisp ones for docs.</p>
        </div>
      )}
    </div>
  );
}

function LayoutMenu({ disabled, selected, onPick }: { disabled: boolean; selected: number; onPick: (kind: LayoutKind, selectionOnly: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const scoped = onlySelected && selected > 1;
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Re-arrange items automatically (Ctrl+Z undoes it)">
        Layout
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="Layout">
          <label className={`check${selected > 1 ? '' : ' off'}`} title={selected > 1 ? undefined : 'Select two or more items first (Shift or Ctrl + click, or drag a box)'}>
            <input type="checkbox" checked={scoped} disabled={selected < 2} onChange={(e) => setOnlySelected(e.target.checked)} />
            Only the selected items{selected > 1 ? ` (${selected})` : ''}
          </label>
          {LAYOUTS.map((x) => (
            <button
              key={x.key}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(x.key, scoped);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{x.title}</span>
                <span className="menu-desc">{x.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXPORTS = [
  { kind: 'png', title: 'PNG image', desc: 'The sheet as it looks now, at 2× resolution' },
  { kind: 'svg', title: 'SVG image', desc: 'Scalable, for docs and slides' },
  { kind: 'mermaid', title: 'Mermaid diagram', desc: 'Flowchart text for Markdown, GitHub, Notion' },
  { kind: 'decisions', title: 'Decision record', desc: 'Every decision with why, alternatives and cost, as Markdown' },
] as const;

function ExportMenu({ disabled, onPick }: { disabled: boolean; onPick: (kind: (typeof EXPORTS)[number]['kind']) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Export
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="Export">
          {EXPORTS.map((x) => (
            <button
              key={x.kind}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(x.kind);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{x.title}</span>
                <span className="menu-desc">{x.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DesignSwitcher({ designs, current, meta, onPick }: { designs: Summary[]; current: string | null; meta?: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const cur = designs.find((d) => d.id === current);
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={meta}>
        <span className="switcher-title">{cur?.title ?? 'Select a design'}</span>
        {cur?.unseen ? <span className="new-count">{cur.unseen} new</span> : null}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Designs">
          {meta && <p className="menu-head">{meta}</p>}
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
