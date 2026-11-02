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
  useReactFlow,
  type Connection as FlowConnection,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toMermaid } from '../core/export.ts';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { ApiError, api, shared, type LiveLoad, type Me, type Plugins, type Summary } from './api.ts';
import { BOUNDARY_SPECS, EMPTY_BOUNDARY, boundaryAt } from './boundaries.ts';
import { EdgeContext, SketchContext, edgeTypes, nodeTypes } from './canvas.tsx';
import type { Pt } from './edges.ts';
import { layout, placeNew, type LayoutKind } from './layout.ts';
import { SequenceView } from './sequence.tsx';
import { DECISION_SIZE, NOTE_SIZE, SHAPES, guessType } from './shapes.ts';
import { type AddKind, AddMenu, DRAG_MIME, ShapePreview } from './palette.tsx';
import { type FlowAt } from './fields.tsx';
import { errorText, type Editing, MAX_IMPORT } from './format.ts';
import { type ExportKind, InlineEdit } from './menus.tsx';
import { Designs } from './designs.tsx';
import { PresentBar, ReviewBar } from './bars.tsx';
import { exportDesign, readSource } from './transfer.ts';
import { TopBar } from './topbar.tsx';
import { deriveSheet } from './derive.ts';
import { useDesignStore } from './use-design-store.ts';
import { useMinimap, useSketch, useTheme } from './use-prefs.ts';
import { Inspector, StepDetails } from './inspector.tsx';
import { Connections } from './connections.tsx';
import { NewDesign } from './new-design.tsx';
import { Icon } from './icons.tsx';

const boundaryKind = (k: string) => (k.startsWith('boundary:') && (BOUNDARY_KINDS as readonly string[]).includes(k.slice(9)) ? (k.slice(9) as BoundaryKind) : null);
const isEmpty = (d: Design, id: string) => !d.components.some((c) => c.boundary === id) && !d.boundaries.some((b) => b.parent === id);
/** Boundaries with nothing inside: the only ones whose own position matters. */
const emptyBoundaries = (d: Design) => d.boundaries.filter((b) => isEmpty(d, b.id));
const isAddKind = (k: string): k is AddKind => k === 'note' || k === 'decision' || !!boundaryKind(k) || (COMPONENT_TYPES as readonly string[]).includes(k);

/** Marks clipboard content copied from this sheet. */
const CLIP_MIME = 'application/x-system-design';
/** Share of the window the step details may take; the stylesheet's .review-sheet max-height matches. */
const DETAILS_HEIGHT = 0.42;
/** Largest file a drop imports; bigger ones would hang the page while parsing. */


export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

/** A link into the app: #<design>, or #<design>/<item> for a step, part, line or any other item in it. */
function readHash() {
  const [design, item] = location.hash.slice(1).split('/').map((x) => decodeURIComponent(x));
  return { design: design || null, item: item || null };
}

function Shell() {
  const [designs, setDesigns] = useState<Summary[]>([]);
  const [templates, setTemplates] = useState<Summary[]>([]);
  const [id, setId] = useState<string | null>(() => readHash().design);
  // An item the address points at, shown once its design has loaded.
  const linkTo = useRef<string | null>(readHash().item);
  const [viewIndex, setViewIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = useDesignStore(setError);
  const { design, designRef, saveState, hist, commit, change, settle } = store;
  const undo = (back: boolean) => {
    if (store.undo(back)) setSelected(null);
  };
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  const [plugins, setPlugins] = useState<Plugins | null>(null);
  const [me, setMe] = useState<Me>(null);
  useEffect(() => void api.me().then(setMe, () => undefined), []);
  useEffect(() => void api.plugins().then(setPlugins, () => undefined), []);
  const pluginExports = useMemo(() => (plugins?.plugins ?? []).flatMap((p) => p.exporters.map((x) => ({ ...x, kind: `plugin:${x.key}` }))), [plugins]);
  const offeredList = useRef(false);
  // Show only parts with this tag (a view of the same model); null shows everything.
  const [tag, setTag] = useState<string | null>(null);
  // Live load from Prometheus (server/api.ts), shown on the lines in place of the designed numbers while on.
  const [live, setLive] = useState<LiveLoad | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [diff, setDiff] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [theme, setTheme] = useTheme();
  const [sketch, setStyle] = useSketch();
  const [minimap, setMinimap] = useMinimap();
  const [flow, setFlow] = useState<FlowAt | null>(null);
  // Stops of a flow being drawn by clicking parts on the sheet.
  const [recording, setRecording] = useState<string[] | null>(null);
  // The flow shown as a sequence diagram over the sheet.
  const [sequence, setSequence] = useState<string | null>(null);
  // Designs left by opening a part's inside, outermost first, so the breadcrumb can lead back.
  const [trail, setTrail] = useState<{ id: string; title: string; via: string }[]>([]);
  // Which option of a step with options is on the sheet; its first until another is chosen.
  const [optionView, setOptionView] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const clip = useRef<{ items: m.Clip; pastes: number } | null>(null);
  /** A copy, cut or paste key still waiting for its clipboard event. */
  const clipKey = useRef<string | null>(null);
  const pendingSelect = useRef<Set<string> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const fittedFor = useRef<string | null>(null);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, getNodes, getInternalNode } = useReactFlow();
  const fitOpts = useRef<FitViewOptions>({});

  const refreshLists = useCallback(() => {
    api.designs().then(setDesigns).catch((e) => setError(errorText(e)));
    api.templates().then(setTemplates).catch((e) => setError(errorText(e)));
  }, []);

  // The open design is gone (deleted on disk, or a stale link): open another one instead of leaving a dead sheet.
  const leave = useCallback(
    async (missing: string, note: string) => {
      commit(null, { fresh: true });
      setSelected(null);
      setError(note);
      const list = await api.designs().catch(() => [] as Summary[]);
      setDesigns(list);
      const next = list.find((x) => x.id !== missing)?.id ?? null;
      if (!next) history.replaceState(null, '', location.pathname);
      setId(next);
    },
    [commit],
  );

  useEffect(() => {
    refreshLists();
    // A shared copy has no server to hear from.
    if (shared) return;
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
        if (e instanceof ApiError && e.status === 404) leave(changed, `“${cur.title}” was deleted, so another design was opened.`);
        else setError(errorText(e));
      }
    };
    return () => es.close();
  }, [refreshLists, commit, leave]);

  // Without a link, reopen the design last worked on; failing that, show the list once instead of guessing.
  useEffect(() => {
    if (id || !designs.length) return;
    const last = localStorage.getItem('sd-last');
    if (last && designs.some((d) => d.id === last)) setId(last);
    else if (shared) setId(designs[0].id);
    else if (!offeredList.current) {
      offeredList.current = true;
      setBrowsing(true);
    }
  }, [id, designs]);

  /** Shows an item of the open design: a step opens it, anything else opens its step and selects it. */
  const showItem = useCallback((d: Design, item: string) => {
    const step = d.steps.findIndex((s) => s.id === item);
    if (step >= 0) return setViewIndex(step), setSelected(null);
    const x = [...d.components, ...d.connections, ...d.boundaries, ...d.notes, ...d.decisions, ...d.flows].find((i) => i.id === item);
    if (!x) return;
    setViewIndex(d.steps.findIndex((s) => s.id === x.step));
    setSelected(x.id);
  }, []);

  // Following a link while the app is open: another design, or another item in this one.
  useEffect(() => {
    const onHash = () => {
      const { design: next, item } = readHash();
      if (!next) return;
      if (next !== designRef.current?.id) {
        linkTo.current = item;
        setTrail([]);
        setId(next);
      } else if (item) showItem(designRef.current, item);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [showItem]);

  useEffect(() => {
    if (!id) return;
    if (!shared) localStorage.setItem('sd-last', id);
    let cancelled = false;
    api
      .get(id)
      .then((d) => {
        if (cancelled) return;
        commit(d, { fresh: true });
        setSelected(null);
        setFlow(null);
        setSequence(null);
        const firstUnseen = d.steps.findIndex((s) => !s.seen);
        setViewIndex(firstUnseen >= 0 ? firstUnseen : d.steps.length - 1);
        if (linkTo.current) showItem(d, linkTo.current);
        linkTo.current = null;
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) leave(id, `There is no design “${id}”, so another one was opened.`);
        else setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, commit, leave, showItem]);

  // The address follows the open design and the selection, so it can be copied as a link to either.
  useEffect(() => {
    if (!id || linkTo.current) return;
    history.replaceState(null, '', `#${[id, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/')}`);
  }, [id, selected]);

  // New items (from agents, templates or a paste) arrive without positions: lay them out once, clear of what is placed.
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
            const at = placeNew(d, pos);
            for (const x of [...d.components, ...d.notes, ...d.decisions, ...emptyBoundaries(d)]) if (!x.position) x.position = at.get(x.id);
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
  // A step that needs reading or a choice opens with its details; the reviewer's own choice for a step stands after that.
  const [stepOpen, setStepOpen] = useState<Record<string, boolean>>({});
  const detailsOpen = !!current && (stepOpen[current.id] ?? (!!current.options || design!.decisions.some((x) => x.step === current.id)));
  // A selected item swaps the step details for its own card.
  const focused = !!design && [...design.components, ...design.connections, ...design.notes, ...design.decisions, ...design.boundaries].some((x) => x.id === selected);
  // The bars float over the sheet, so fitting leaves room for them and for the details unfolded above the review bar.
  fitOpts.current = {
    padding: { left: '40px', right: '40px', top: presenting ? '40px' : '72px', bottom: !presenting && detailsOpen ? `${Math.round(window.innerHeight * DETAILS_HEIGHT) + 100}px` : '108px' },
    duration: 300,
    maxZoom: 1.2,
  };

  const inOption = useCallback(
    (x: { step: string; option?: string }) => !x.option || x.option === (optionView[x.step] ?? design?.steps.find((s) => s.id === x.step)?.options?.[0].id),
    [optionView, design],
  );
  const pickOption = (step: string, option: string) => {
    change((d) => m.pickOption(d, step, option));
    setSelected(null);
  };

  const derived = useMemo(
    () => deriveSheet({ design, current, view, selected, diff, presenting, flow, recording, inOption, tag, live }),
    [design, current, view, selected, diff, presenting, flow, recording, inOption, tag, live],
  );

  const designId = design?.id;
  useEffect(() => {
    setLive(null);
    if (!liveOn || !designId) return;
    let stop = false;
    const poll = () =>
      api.live(designId).then(
        (l) => !stop && setLive(l),
        (e) => {
          if (stop) return;
          setLiveOn(false);
          setError(`Live load: ${errorText(e)}`);
        },
      );
    void poll();
    const timer = setInterval(poll, 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [liveOn, designId]);

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
    setAdding(false);
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
  const drill = async (target: string, via: string) => {
    if (!design) return;
    await settle();
    setTrail((t) => [...t, { id: design.id, title: design.title, via }]);
    setId(target);
  };
  const backTo = async (i: number) => {
    await settle();
    setId(trail[i].id);
    setTrail(trail.slice(0, i));
  };
  /** Starts an empty design for what is inside a part, links the part to it and opens it. */
  const createInside = async (componentId: string) => {
    const c = design?.components.find((x) => x.id === componentId);
    if (!design || !c) return;
    const base = m.slugify(`${design.id}-${c.id}`);
    let target = base;
    for (let i = 2; designs.some((x) => x.id === target); i++) target = `${base}-${i}`;
    try {
      await api.create({ id: target, title: c.label });
    } catch (e) {
      setError(errorText(e));
      return;
    }
    change((d) => {
      const x = d.components.find((i) => i.id === componentId);
      if (x) x.detail = target;
    });
    refreshLists();
    await drill(target, c.label);
  };
  const edgeActions = {
    locked: presenting,
    onOpen: (target: string, via: string) => void drill(target, via),
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

  // Drawing a flow clears any selection so clicks only add stops.
  const startRecording = (r: string[] | null) => {
    setFlow(null);
    setSelected(null);
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setRecording(r);
  };
  const present = (on: boolean) => {
    setPresenting(on);
    setSelected(null);
    setRecording(null);
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

  const exportAs = (kind: ExportKind) =>
    design &&
    exportDesign(kind, {
      design,
      plugged: pluginExports.find((x) => x.kind === kind),
      settle,
      canvas: canvasRef.current,
      nodes: getNodes().filter((n) => !n.hidden),
      onError: setError,
    });

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

  const goTo = (i: number) => {
    setSelected(null);
    setViewIndex(Math.max(0, Math.min(i, maxIndex)));
  };

  const seenNext = () => {
    if (!design || !current) return;
    if (current.seen) return goTo(view + 1);
    if (current.options) return setError('Pick one of this step’s options first.');
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
        const playing = flow && design?.flows.find((f) => f.id === flow.id && m.stepIndex(design).get(f.step)! <= view);
        if (playing && flow) {
          const last = playing.path.length - 2;
          if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) setFlow({ ...flow, at: Math.min(flow.at + 1, last) });
          else if (['ArrowLeft', 'PageUp'].includes(e.key)) setFlow({ ...flow, at: Math.max(flow.at - 1, 0) });
          else if (e.key === 'Escape') setFlow(null);
          else return;
        } else if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) goTo(view + 1);
        else if (['ArrowLeft', 'PageUp'].includes(e.key)) goTo(view - 1);
        else if (e.key === 'Escape') present(false);
        else return;
        e.preventDefault();
        return;
      }
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 'f' && design) {
        e.preventDefault();
        setFinding(true);
        findRef.current?.focus();
        return;
      }
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (mod) {
        if (key === 'z') undo(!e.shiftKey);
        else if (key === 'y') undo(false);
        else if (key === 'd') duplicate();
        else if (design && (key === '+' || key === '=')) void zoomIn({ duration: 150 });
        else if (design && key === '-') void zoomOut({ duration: 150 });
        else if (key === 'c' || key === 'x' || key === 'v') {
          // The browser follows with a clipboard event (handled below, so text travels to and from other apps);
          // where none comes, the key acts on the sheet's own clipboard.
          clipKey.current = key;
          setTimeout(() => {
            if (clipKey.current !== key) return;
            clipKey.current = null;
            if (key === 'v') return void (clip.current && pasteClip(clip.current));
            if (copy() && key === 'x') {
              remove(selectedIds());
              setSelected(null);
            }
          });
          return;
        } else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (e.key === 'Escape') {
        setSelected(null);
        setRecording(null);
        setSequence(null);
      }
      if (e.key === '/' && design) {
        e.preventDefault();
        setAdding(true);
        return;
      }
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

  /** Adds a pasted or dropped diagram or infrastructure file to the design as a new step, and shows that step. */
  const importSource = async (raw: string, what: string) => {
    const read = await readSource(raw, what);
    if (typeof read === 'string') return setError(read);
    const before = designRef.current?.steps.length ?? 0;
    change((d) => void read.importAsStep(d, read.text, { seen: true, guess: guessType, plugin: read.plugin }));
    const after = designRef.current?.steps.length ?? 0;
    if (after > before) {
      setSelected(null);
      setViewIndex(after - 1);
    }
  };

  // Copied parts go to the clipboard as a Mermaid flowchart for other apps, marked so a paste here keeps every detail.
  // A pasted diagram or infrastructure file (Mermaid, C4-PlantUML, compose, Kubernetes, Terraform, traces) becomes a new step.
  useEffect(() => {
    const ignore = (e: ClipboardEvent) => creating || presenting || !design || !!(e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
    const onCopy = (e: ClipboardEvent) => {
      clipKey.current = null;
      if (ignore(e) || window.getSelection()?.toString() || !copy()) return;
      const c = clip.current!.items, inside = new Set(c.boundaries.map((b) => b.id));
      const text = toMermaid({
        ...design!,
        ...c,
        components: c.components.map((x) => (x.boundary && inside.has(x.boundary) ? x : { ...x, boundary: undefined })),
        boundaries: c.boundaries.map((b) => (b.parent && inside.has(b.parent) ? b : { ...b, parent: undefined })),
      });
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData(CLIP_MIME, '1');
      e.preventDefault();
      if (e.type === 'cut') {
        remove(selectedIds());
        setSelected(null);
      }
    };
    const onPaste = async (e: ClipboardEvent) => {
      clipKey.current = null;
      if (ignore(e) || !current) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const ours = e.clipboardData?.types.includes(CLIP_MIME);
      e.preventDefault();
      if (ours || !text.trim()) return void (clip.current && pasteClip(clip.current));
      await importSource(text, 'paste');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  });

  return (
    <SketchContext.Provider value={sketch}>
      <div className={`app${presenting ? ' presenting' : ''}`}>
        <TopBar
          design={design}
          designs={designs}
          currentId={id}
          me={me}
          canUndo={!!hist.current.past.length}
          canRedo={!!hist.current.future.length}
          onUndo={undo}
          onFind={() => setFinding(true)}
          tag={tag}
          onTag={setTag}
          live={live}
          liveOn={liveOn}
          onLiveToggle={() => setLiveOn((on) => !on)}
          selectedCount={nodes.filter((n) => n.selected).length}
          onArrange={arrange}
          exportExtras={pluginExports}
          onExport={exportAs}
          onPresent={() => present(true)}
          minimap={minimap}
          onMinimap={setMinimap}
          sketch={sketch}
          onSketch={setStyle}
          theme={theme}
          onTheme={setTheme}
          change={change}
          onCreate={() => setCreating(true)}
          onPickDesign={(x) => (setTrail([]), setId(x))}
          onBrowse={() => setBrowsing(true)}
          onConnections={() => setConnecting(true)}
          find={design && finding ? { design, visible: nodes.filter((n) => !n.hidden).map((n) => n.id).concat(derived.edges.map((e) => e.id)), onPick: findPick, inputRef: findRef, onClose: () => setFinding(false) } : null}
        />

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
                if (isAddKind(kind)) return add(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
                // A file from elsewhere (.drawio, .dsl, .mmd, compose, manifests…) imports like a paste.
                const file = e.dataTransfer.files[0];
                if (!file) return;
                if (file.size > MAX_IMPORT) return setError(`${file.name} is too big to import (over ${MAX_IMPORT / 1e6} MB).`);
                file
                  .text()
                  .then((t) => importSource(t, 'file'))
                  .catch((err) => setError(errorText(err)));
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
                  onNodeClick={(e, n) => {
                    if (recording) {
                      // Each stop must follow a connection from the last one.
                      const last = recording.at(-1);
                      if (n.type === 'component' && (!last || (last !== n.id && m.hopConnection(design, last, n.id)))) setRecording([...recording, n.id]);
                    } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelected(n.id);
                  }}
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
                  elementsSelectable={!presenting && !recording}
                  zoomOnDoubleClick={false}
                  connectionMode={ConnectionMode.Loose}
                  colorMode={theme}
                  minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={28} size={1} />
                  {!presenting && <Controls showZoom={false} showInteractive={false} position="bottom-right" fitViewOptions={fitOpts.current} />}
                  {!presenting && minimap && (
                    <MiniMap
                      position="top-right"
                      pannable
                      zoomable
                      ariaLabel="Overview"
                      style={{ width: 160, height: 104 }}
                      nodeColor={(n) => (n.type === 'boundary' ? 'transparent' : 'var(--quiet)')}
                      nodeStrokeColor={(n) => (n.type === 'boundary' ? 'var(--quiet)' : 'transparent')}
                      nodeStrokeWidth={2}
                    />
                  )}
                  <ViewportPortal>{editing && <InlineEdit key={editing.id} {...editing} onDone={finishEdit} />}</ViewportPortal>
                </ReactFlow>
              </EdgeContext.Provider>
              {trail.length > 0 && !presenting && (
                <nav className="trail" aria-label="Opened from">
                  {trail.map((t, i) => (
                    <span key={`${t.id}-${i}`}>
                      <button className="text-btn" onClick={() => void backTo(i)} title={`Back to ${t.title}`}>
                        {t.title}
                      </button>
                      {/* The part's name only when the design it opened is called something else. */}
                      <span className="quiet">› {t.via !== (trail[i + 1]?.title ?? design.title) && `${t.via} ›`}</span>
                    </span>
                  ))}
                  <strong>{design.title}</strong>
                </nav>
              )}
              {(() => {
                const f = sequence && design.flows.find((x) => x.id === sequence);
                return f && !presenting && <SequenceView design={design} flow={f} at={flow?.id === f.id ? flow.at : undefined} onClose={() => setSequence(null)} />;
              })()}
              {presenting ? (
                <PresentBar design={design} viewIndex={view} maxIndex={maxIndex} onView={goTo} onExit={() => present(false)} flow={flow} onFlow={setFlow} />
              ) : (
                <ReviewBar
                  design={design}
                  viewIndex={view}
                  maxIndex={maxIndex}
                  onView={goTo}
                  onSeenNext={seenNext}
                  onRequestChanges={requestChanges}
                  open={detailsOpen && !focused}
                  onToggle={() => {
                    setSelected(null);
                    setStepOpen((o) => ({ ...o, [current.id]: focused || !detailsOpen }));
                  }}
                >
                  <StepDetails design={design} stepId={current.id} diff={diff} onDiff={() => setDiff((x) => !x)} flow={flow} onFlow={setFlow} recording={recording} onRecording={startRecording} onSequence={setSequence} inOption={inOption} optionView={optionView} onOption={(s, o) => setOptionView((v) => ({ ...v, [s]: o }))} onPickOption={pickOption} change={change} onSelect={setSelected} />
                </ReviewBar>
              )}
            </div>
            {!presenting && <AddMenu open={adding} onOpen={setAdding} onAdd={(k) => add(k)} />}
            {!presenting && focused && (
              <div className="card">
                <Inspector design={design} selected={selected} stepId={current.id} inOption={inOption} designs={designs} onOpenInside={(c) => void drill(c.detail!, c.label)} onCreateInside={(c) => void createInside(c)} change={change} onSelect={setSelected} onDelete={(x) => (remove([x]), setSelected(null))} />
              </div>
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
                            <button className="btn ink lg" onClick={() => setCreating(true)}>
                <Icon name="plus" />
                New design
              </button>
              {!shared && (
                <button className="text-btn" onClick={() => setBrowsing(true)}>
                  <Icon name="folder" />
                  All designs
                </button>
              )}
            </div>
          )
        )}

        {connecting && <Connections design={design} selected={selected} plugins={plugins} onClose={() => setConnecting(false)} />}
        {browsing && (
          <Designs
            designs={designs}
            current={id}
            onClose={() => setBrowsing(false)}
            onChanged={refreshLists}
            onOpen={(x) => {
              setBrowsing(false);
              setTrail([]);
              setId(x);
              refreshLists();
            }}
          />
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
            <span className="toast-msg">{error}</span>
            <button className="text-btn" onClick={() => setError(null)} aria-label="Dismiss">
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>
    </SketchContext.Provider>
  );
}
