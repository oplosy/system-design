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
import { codeUrl, costAt, toDecisionRecord, toMermaid } from '../core/export.ts';
import { toDrawio, toPlantUml, toStructurizr } from '../core/interop.ts';
import { lint } from '../core/lint.ts';
import { BOUNDARY_KINDS, COMPONENT_TYPES, parseDesign, type BoundaryKind, type ComponentType, type Design } from '../core/schema.ts';
import { mergeDesigns } from '../core/merge.ts';
import * as m from '../core/mutations.ts';
import { ApiError, api, shared, type Hook, type LiveLoad, type McpServers, type Me, type PluginRead, type Plugins, type Summary, type Trashed } from './api.ts';
import { BOUNDARY_SPECS, EMPTY_BOUNDARY, boundaryAt, boundaryBoxes } from './boundaries.ts';
import { EdgeContext, SketchContext, edgeTypes, nodeTypes, type FlowEdge } from './canvas.tsx';
import type { Pt } from './edges.ts';
import { LAYOUTS, layout, placeNew, type LayoutKind } from './layout.ts';
import { SequenceView } from './sequence.tsx';
import { DRAG_MIME, Dock, FindBox, Inspector, type FlowAt, Palette, PresentBar, ReviewBar, ShapePreview, type AddKind } from './panels.tsx';
import { DECISION_SIZE, GROUP_COLOR, NOTE_COLOR, NOTE_SIZE, SHAPES, guessType } from './shapes.ts';

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
/** Marks clipboard content copied from this sheet. */
const CLIP_MIME = 'application/x-system-design';
/** Largest file a drop imports; bigger ones would hang the page while parsing. */
const MAX_IMPORT = 5e6;

type Editing = { id: string; at: Pt; value: string; multiline: boolean };

/** Removed components drawn where they stood; one that a live part now covers moves down until it is clear. */
function ghosts(removed: NonNullable<Design['steps'][number]['removed']>, live: Design['components']) {
  const rect = (type: ComponentType, p: { x: number; y: number }) => ({ ...p, w: SHAPES[type].w, h: SHAPES[type].h });
  const taken = live.filter((c) => c.position).map((c) => rect(c.type, c.position!));
  const hits = (a: ReturnType<typeof rect>) => taken.some((b) => a.x < b.x + b.w + 20 && b.x < a.x + a.w + 20 && a.y < b.y + b.h + 20 && b.y < a.y + a.h + 20);
  return removed.flatMap((r): Node[] => {
    if (!r.type || !r.position) return [];
    const at = rect(r.type, r.position);
    for (let i = 0; i < 50 && hits(at); i++) at.y += at.h + 20;
    taken.push(at);
    return [
      { id: `ghost-${r.id}`, type: 'component', position: { x: at.x, y: at.y }, selectable: false, draggable: false, connectable: false, deletable: false, data: { type: r.type, label: r.label, removed: true, unseen: false, faded: false } },
    ];
  });
}

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
  const [design, setDesign] = useState<Design | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sketch, setSketch] = useState(loadStyle);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [connecting, setConnecting] = useState(false);
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
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [docks, setDocks] = useState<Docks>(loadDocks);
  const designRef = useRef<Design | null>(null);
  const saveState = useRef({ timer: undefined as number | undefined, pending: false, inFlight: false, dirty: false });
  // Undo history of whole designs. It restarts whenever the design is replaced from disk.
  const hist = useRef({ past: [] as Design[], future: [] as Design[], at: 0 });
  const clip = useRef<{ items: m.Clip; pastes: number } | null>(null);
  /** A copy, cut or paste key still waiting for its clipboard event. */
  const clipKey = useRef<string | null>(null);
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

  // The design as last loaded or saved: what local edits are replayed from when a save meets a newer file.
  const baseRef = useRef<Design | null>(null);
  const commit = useCallback((d: Design | null, { fresh = false } = {}) => {
    designRef.current = d;
    setDesign(d);
    if (fresh) {
      hist.current = { past: [], future: [], at: 0 };
      baseRef.current = d;
    }
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
      baseRef.current = saved;
      if (designRef.current?.id === saved.id) commit({ ...designRef.current, rev: saved.rev });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone (usually an agent) wrote meanwhile: replay the edits since the last save onto their version.
        const theirs = await api.get(d.id);
        const base = baseRef.current;
        const result = base?.id === d.id ? mergeDesigns(base, designRef.current?.id === d.id ? designRef.current : d, theirs) : undefined;
        if (result) {
          baseRef.current = theirs;
          commit(result.merged);
          s.dirty = true;
          setError(result.clashes.length ? `This design changed on disk while you edited; your edits were kept on top (overrode: ${result.clashes.join(', ')}).` : null);
        } else {
          s.dirty = false;
          commit(theirs, { fresh: true });
          setError('This design changed on disk (probably an agent) in a way your last edit can’t be merged into, so it was reloaded and that edit dropped.');
        }
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

  const inOption = useCallback(
    (x: { step: string; option?: string }) => !x.option || x.option === (optionView[x.step] ?? design?.steps.find((s) => s.id === x.step)?.options?.[0].id),
    [optionView, design],
  );
  const pickOption = (step: string, option: string) => {
    change((d) => m.pickOption(d, step, option));
    setSelected(null);
  };

  const derived = useMemo(() => {
    if (!design || !current) return { nodes: [] as Node[], edges: [] as FlowEdge[], boxes: new Map() as ReturnType<typeof boundaryBoxes> };
    const idx = m.stepIndex(design);
    const visibleStep = (step: string) => idx.get(step)! <= view;
    const onSheet = (x: { step: string; option?: string }) => visibleStep(x.step) && inOption(x);
    const reviewing = !current.seen;
    // Reviewing, the diff view and presenting all put this step's items in front; the diff view also outlines them.
    const focus = reviewing || diff || presenting;
    // A playing flow dims everything off its path and numbers its hops.
    const playing = recording?.length ? { path: recording } : flow && design.flows.find((f) => f.id === flow.id && onSheet(f));
    const onPath = new Set(playing?.path);
    const hops = new Map<string, number[]>();
    let hopOn: string | undefined;
    playing?.path.slice(1).forEach((to, i) => {
      const c = m.hopConnection(design, playing.path[i], to);
      if (!c) return;
      hops.set(c.id, [...(hops.get(c.id) ?? []), i + 1]);
      if (i === (recording ? recording.length - 2 : flow!.at)) hopOn = c.id;
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
      const seen = <T extends { step: string; option?: string }>(xs: T[]) => xs.filter(onSheet);
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
    // A tag view hides untagged parts, notes on them and boxes left with nothing inside.
    const hidden = new Set<string>();
    if (tag) {
      const parent = new Map(design.boundaries.map((b) => [b.id, b.parent]));
      const occupied = new Set<string>();
      for (const c of design.components) {
        if (!c.tags?.includes(tag)) hidden.add(c.id);
        else for (let b = c.boundary, i = 0; b && i <= design.boundaries.length; b = parent.get(b), i++) occupied.add(b);
      }
      for (const b of design.boundaries) if (!occupied.has(b.id)) hidden.add(b.id);
      for (const n of design.notes) if (n.attachTo && hidden.has(n.attachTo)) hidden.add(n.id);
    }
    const show = (x: { step: string; option?: string; id?: string }) => onSheet(x) && !(x.id && hidden.has(x.id));
    const boxes = boundaryBoxes(design, show);
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
      ...ghosts(diff ? current.removed ?? [] : [], design.components.filter(onSheet)),
      ...design.components.filter(show).map((c) => node(c.id, 'component', c.position, { type: c.type, label: c.label, tech: c.tech, detail: c.detail, cost: costAt(design, c, current.id), currency: design.currency, code: codeUrl(design, c.code) }, c.step)),
      ...design.notes.filter(show).map((n) => node(n.id, 'note', n.position, { text: n.text }, n.step)),
      ...design.decisions.filter(onSheet).map((x) => node(x.id, 'decision', x.position, { title: x.title, why: x.why }, x.step)),
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
        .filter((c) => onSheet(c) && both(c.from, c.to))
        .map(
          (c): FlowEdge => ({
            id: c.id,
            source: c.from,
            target: c.to,
            type: 'rough',
            selected: c.id === selected,
            data: { kind: 'flow', label: c.label, async: c.async, relation: c.kind, route: c.route, bend: c.bend, ...(live?.lines[c.id] ? { ...live.lines[c.id], live: true } : { qps: c.qps, latency: c.latency }), hops: hops.get(c.id), hopOn: c.id === hopOn, ...flags(c.step, c.id) },
          }),
        ),
      ...design.notes.filter((n) => n.attachTo && both(n.attachTo, n.id)).map((n) => link(`link-${n.id}`, n.attachTo!, n.id, n.step)),
      ...design.decisions.flatMap((x) => x.links.filter((l) => both(l, x.id)).map((l) => link(`link-${x.id}-${l}`, l, x.id, x.step))),
    ];
    return { nodes, edges, boxes };
  }, [design, current, view, selected, diff, presenting, flow, recording, inOption, tag, live]);

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
  /** Saves a pending edit now, so switching designs cannot drop it. */
  const settle = async () => {
    clearTimeout(saveState.current.timer);
    if (saveState.current.pending) await flush();
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

  const exportAs = async (kind: ExportKind) => {
    if (!design) return;
    if (kind === 'mermaid') return downloadText(toMermaid(design), `${design.id}.mmd`);
    const plugged = pluginExports.find((x) => x.kind === kind);
    if (kind === 'html' || plugged) {
      // The server builds the file from what is on disk, so save the last edit first.
      clearTimeout(saveState.current.timer);
      if (saveState.current.pending) await flush();
      try {
        const res = await fetch(plugged ? `/api/v1/designs/${design.id}/export/${encodeURIComponent(plugged.key)}` : `/api/designs/${design.id}/share`);
        if (!res.ok) return setError(`Export failed: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
        const url = URL.createObjectURL(await res.blob());
        download(url, `${design.id}.${plugged?.extension ?? 'html'}`);
        return setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        return setError(`Export failed: ${errorText(e)}`);
      }
    }
    if (kind === 'decisions') return downloadText(toDecisionRecord(design), `${design.id}-decisions.md`);
    if (kind === 'structurizr') return downloadText(toStructurizr(design), `${design.id}.dsl`);
    if (kind === 'plantuml') return downloadText(toPlantUml(design), `${design.id}.puml`);
    if (kind === 'drawio') return downloadText(toDrawio(design), `${design.id}.drawio`);
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
      filter: (n: HTMLElement) => !['inline-edit', 'bend-handle', 'unseen-dot', 'comment-badge', 'lint-badge', 'node-open', 'node-code'].some((c) => n.classList?.contains(c)),
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
    if (current.options) return setError('Pick one of this step’s options first (details panel).');
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
        findRef.current?.focus();
        return;
      }
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (mod) {
        if (key === 'z') undo(!e.shiftKey);
        else if (key === 'y') undo(false);
        else if (key === 'd') duplicate();
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
    // Loaded only here, so the YAML parser stays out of the main bundle.
    const { formatOf, importAsStep, unpack } = await import('../core/importer.ts');
    let text: string;
    try {
      text = await unpack(raw);
    } catch (e) {
      return setError(`That ${what} can’t be read: ${errorText(e)}`);
    }
    let plugin: PluginRead = null;
    try {
      plugin = await api.readWithPlugin(text);
    } catch (e) {
      return setError(`That ${what} can’t be read: ${errorText(e)}`);
    }
    if (!plugin && !formatOf(text)) return setError(`That ${what} isn’t a diagram or infrastructure file this can read.`);
    const before = designRef.current?.steps.length ?? 0;
    change((d) => void importAsStep(d, text, { seen: true, guess: guessType, plugin }));
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
            {designs.length > 0 && <DesignSwitcher designs={designs} current={id} onPick={(x) => (setTrail([]), setId(x))} onAll={shared ? undefined : () => setBrowsing(true)} onConnections={shared || me ? undefined : () => setConnecting(true)} user={me} meta={design ? `rev ${design.rev} · ${design.components.length} parts · ${design.decisions.length} decisions` : undefined} />}
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
            {design && <TagMenu design={design} tag={tag} onPick={setTag} />}
            {design && !shared && (
              <button
                className="text-btn"
                aria-pressed={liveOn}
                onClick={() => setLiveOn((on) => !on)}
                title={live?.unmatched.length ? `Live load from Prometheus. No line for: ${live.unmatched.join(', ')}` : 'Show measured load and latency on the lines'}
              >
                Live
              </button>
            )}
            <LayoutMenu disabled={!design} selected={nodes.filter((n) => n.selected).length} onPick={arrange} />
            <ExportMenu disabled={!design} extra={pluginExports} onPick={exportAs} />
            <button className="text-btn" disabled={!design} onClick={() => present(true)} title="Walk through the steps full screen">
              Present
            </button>
            <span className="vrule" />
            <AppearanceMenu sketch={sketch} onSketch={setStyle} theme={theme} onTheme={setTheme} icon={icon} />
            {design && dockToggle('right')}
            {shared ? (
              <span className="shared-tag" title="Opened from a shared file. You can walk the steps and try changes, but nothing is saved.">
                Shared copy
              </span>
            ) : (
              <button className="btn ink" onClick={() => setCreating(true)}>
                New design
              </button>
            )}
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
                <Inspector design={design} selected={selected} stepId={current.id} flow={flow} onFlow={setFlow} recording={recording} onRecording={startRecording} onSequence={setSequence} inOption={inOption} optionView={optionView} onOption={(s, o) => setOptionView((v) => ({ ...v, [s]: o }))} onPickOption={pickOption} designs={designs} onOpenInside={(c) => void drill(c.detail!, c.label)} onCreateInside={(c) => void createInside(c)} change={change} onSelect={setSelected} onDelete={(x) => (remove([x]), setSelected(null))} />
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
              {!shared && (
                <button className="text-btn" onClick={() => setBrowsing(true)}>
                  Restore a deleted design or add one from a file
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

/** Views of one model: everything, or only the parts with one tag. */
function TagMenu({ design, tag, onPick }: { design: Design; tag: string | null; onPick: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const counts = new Map<string, number>();
  for (const c of design.components) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  // A tag that no part carries any more (renamed, removed, another design) falls back to everything.
  useEffect(() => {
    if (tag && !counts.has(tag)) onPick(null);
  });
  if (!counts.size) return null;
  const pick = (t: string | null) => {
    setOpen(false);
    onPick(t);
  };
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" aria-haspopup="menu" aria-expanded={open} aria-pressed={!!tag} onClick={() => setOpen((o) => !o)} title="Show only the parts with one tag">
        {tag ? `View: ${tag}` : 'View'}
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="View">
          <button role="menuitemradio" aria-checked={!tag} className="menu-item" onClick={() => pick(null)}>
            <span className="menu-main">
              <span className="menu-title">Everything</span>
              <span className="menu-desc">Every part on the sheet</span>
            </span>
          </button>
          {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => (
            <button key={t} role="menuitemradio" aria-checked={tag === t} className="menu-item" onClick={() => pick(t)}>
              <span className="menu-main">
                <span className="menu-title">{t}</span>
                <span className="menu-desc">
                  {n} {n > 1 ? 'parts' : 'part'}
                </span>
              </span>
            </button>
          ))}
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
  { kind: 'structurizr', title: 'Structurizr DSL', desc: 'C4 container model for Structurizr' },
  { kind: 'plantuml', title: 'C4-PlantUML', desc: 'C4 container diagram as PlantUML' },
  { kind: 'drawio', title: 'draw.io', desc: 'Editable diagram for diagrams.net, positions kept' },
  { kind: 'html', title: 'Shared HTML', desc: 'One file that opens anywhere: walk the steps, play flows; nothing is saved' },
] as const;

type ExportKind = (typeof EXPORTS)[number]['kind'] | `plugin:${string}`;

function ExportMenu({ disabled, extra, onPick }: { disabled: boolean; extra: { kind: string; name: string; extension: string }[]; onPick: (kind: ExportKind) => void }) {
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
          {[...EXPORTS.filter((x) => !(shared && x.kind === 'html')), ...extra.map((x) => ({ kind: x.kind as ExportKind, title: x.name, desc: `From a plugin, as .${x.extension}` }))].map((x) => (
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

function DesignSwitcher({ designs, current, meta, onPick, onAll, onConnections, user }: { designs: Summary[]; current: string | null; meta?: string; onPick: (id: string) => void; onAll?: () => void; onConnections?: () => void; user: Me }) {
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
          {onAll && (
            <button
              className="menu-item menu-all"
              onClick={() => {
                setOpen(false);
                onAll();
              }}
            >
              All designs, trash and files…
            </button>
          )}
          {user && (
            <a className="menu-item menu-all" href="/auth/logout">
              Sign out {user.email}
            </a>
          )}
          {onConnections && (
            <button
              className="menu-item menu-all"
              onClick={() => {
                setOpen(false);
                onConnections();
              }}
            >
              Connections: webhooks, API, links…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ago = (t?: number) => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};

/** Every design on this machine: open, rename, copy, download, delete to the trash and restore, or add one from a file. */
function Designs({ designs, current, onOpen, onClose, onChanged }: { designs: Summary[]; current: string | null; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<Trashed[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [dir, setDir] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(!renaming, onClose);
  const loadTrash = useCallback(() => api.trashed().then(setTrashed).catch((e) => setErr(errorText(e))), []);
  useEffect(() => {
    loadTrash();
    api.info().then((i) => setDir(i.dir)).catch(() => {});
  }, [loadTrash, designs]);
  // Each action reports its own error here, and refreshes the list the app keeps.
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      onChanged();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const rename = (id: string, title: string) =>
    run(async () => {
      setRenaming(null);
      const d = await api.get(id);
      if (title.trim() && title.trim() !== d.title) await api.save({ ...d, title: title.trim() });
    });
  const copy = (s: Summary) =>
    run(async () => {
      const title = `${s.title} copy`;
      let id = m.slugify(title);
      for (let n = 2; designs.some((x) => x.id === id); n++) id = `${m.slugify(title)}-${n}`;
      await api.create({ id, title, from: s.id });
    });
  const download = (id: string) =>
    run(async () => {
      const d = await api.get(id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = `${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  const upload = (f: File) =>
    run(async () => {
      if (f.size > MAX_IMPORT) throw new Error('That file is too big to be a design.');
      let raw: unknown;
      try {
        raw = JSON.parse(await f.text());
      } catch {
        throw new Error(`${f.name} isn’t a design file (JSON exported from here).`);
      }
      onOpen((await api.importFile(raw)).id);
    });
  const q = query.trim().toLowerCase();
  const shown = designs
    .filter((d) => !q || `${d.title} ${d.description ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (byName ? a.title.localeCompare(b.title) : (b.updated ?? 0) - (a.updated ?? 0)));
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="designs-title">
        <header className="dialog-head">
          <span className="tag" id="designs-title">
            Designs · {designs.length}
          </span>
          <button type="button" className="text-btn" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div className="designs-tools">
          <input className="find-input" autoFocus value={query} placeholder="Search designs" aria-label="Search designs" onChange={(e) => setQuery(e.target.value)} />
          <button className="text-btn" onClick={() => setByName((x) => !x)} title="Change the order">
            {byName ? 'A–Z' : 'Recent'}
          </button>
        </div>
        {err && <em className="ed-error">{err}</em>}
        <ul className="designs-list">
          {shown.map((d) => (
            <li key={d.id} className="designs-row" aria-current={d.id === current || undefined}>
              {renaming === d.id ? (
                <input
                  className="find-input"
                  autoFocus
                  defaultValue={d.title}
                  aria-label="New title"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(d.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => rename(d.id, e.currentTarget.value)}
                />
              ) : (
                <button className="designs-open" onClick={() => onOpen(d.id)}>
                  <span className="choice-main">
                    <strong>{d.title}</strong>
                    {d.description && <span>{d.description}</span>}
                  </span>
                  <span className="menu-meta">
                    {d.unseen ? <span className="new-count">{d.unseen} new</span> : `${pad(d.steps)} steps`} · {ago(d.updated)}
                  </span>
                </button>
              )}
              <span className="designs-actions">
                <button className="text-btn" onClick={() => setRenaming(d.id)}>Rename</button>
                <button className="text-btn" onClick={() => copy(d)}>Copy</button>
                <button className="text-btn" onClick={() => download(d.id)} title="Download as a .json file">Download</button>
                <button className="text-btn danger" onClick={() => run(() => api.trash(d.id))} title="Move to the trash; it can be restored">Delete</button>
              </span>
            </li>
          ))}
          {!shown.length && <li className="designs-empty">{designs.length ? 'No design matches.' : 'No designs yet.'}</li>}
        </ul>
        {trashed.length > 0 && (
          <>
            <button className="text-btn" aria-expanded={showTrash} onClick={() => setShowTrash((x) => !x)}>
              Recently deleted · {trashed.length}
            </button>
            {showTrash && (
              <ul className="designs-list">
                {trashed.map((t) => (
                  <li key={t.entry} className="designs-row">
                    <span className="choice-main">
                      <strong>{t.title}</strong>
                      <span>Deleted {ago(t.deleted)}</span>
                    </span>
                    <span className="designs-actions">
                      <button className="text-btn" onClick={() => run(async () => (await api.restore(t.entry), loadTrash()))}>Restore</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <footer className="dialog-foot designs-foot">
          {dir && (
            <span className="designs-dir" title="Every design is a JSON file in this folder">
              Saved in <code>{dir}</code>
              <button className="text-btn" onClick={() => navigator.clipboard?.writeText(dir)}>Copy path</button>
            </span>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Add from file</button>
        </footer>
      </div>
    </div>
  );
}

const EVENT_CHOICES = [
  { label: 'Everything', events: undefined },
  { label: 'Steps (added, approved, sent back)', events: ['step.*'] },
  { label: 'Steps and comments', events: ['step.*', 'comment.*'] },
  { label: 'Parts and lines', events: ['part.*', 'line.*', 'boundary.*'] },
  { label: 'Decisions', events: ['decision.*'] },
] as const;

/**
 * Where the app meets the rest of the world: webhooks that get every change, and the addresses other tools and
 * agents use (a link to what is open, the versioned API, its OpenAPI document, the design schema, change events, MCP).
 */
function Connections({ design, selected, plugins, onClose }: { design: Design | null; selected: string | null; plugins: Plugins | null; onClose: () => void }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'cloudevents' | 'chat'>('cloudevents');
  const [choice, setChoice] = useState(0);
  const [onlyThis, setOnlyThis] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [mcp, setMcp] = useState<McpServers | null>(null);
  useDismiss(true, onClose);
  useEffect(() => void api.mcp().then(setMcp, (e) => setErr(errorText(e))), []);
  const testMcp = (name: string) =>
    run(async () => {
      setResults((r) => ({ ...r, [name]: 'Connecting…' }));
      const r = await api.mcpTest(name);
      setResults((x) => ({ ...x, [name]: r.ok ? `Connected: ${r.tools} tools, ${r.readOnly} read-only` : `Failed: ${r.error}` }));
    });
  const load = useCallback(() => api.hooks().then(setHooks).catch((e) => setErr(errorText(e))), []);
  useEffect(() => void load(), [load]);
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      await load();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const events = EVENT_CHOICES[choice].events;
      await api.addHook({ url: url.trim(), format, events: events && [...events], designs: onlyThis && design ? [design.id] : undefined, secret: secret || undefined });
      setUrl('');
      setSecret('');
    });
  };
  const test = (h: Hook) =>
    run(async () => {
      setResults((r) => ({ ...r, [h.id]: 'Sending…' }));
      const r = await api.testHook(h.id);
      setResults((x) => ({ ...x, [h.id]: r.ok ? `Answered ${r.status}` : `Failed: ${r.error ?? `answered ${r.status}`}` }));
    });
  const origin = location.origin;
  const link = design ? `${origin}/#${[design.id, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/')}` : null;
  const copy = (what: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(what));
  const addresses: [string, string, string][] = [
    ['API', `${origin}/api/v1`, 'Designs, templates, trash and webhooks over JSON'],
    ['Plugins', `${origin}/api/v1/plugins`, 'What is installed here'],
    ['OpenAPI', `${origin}/api/v1/openapi.json`, 'Generate a client, or import it into Postman, n8n or Zapier'],
    ['Design schema', `${origin}/api/v1/schema/design.json`, 'JSON Schema of a design file'],
    ['Change stream', `${origin}/api/v1/events`, 'Server-sent events whenever a design changes'],
    ['MCP', 'npx -y github:oplosy/system-design mcp', 'Command that starts the MCP server for an agent'],
  ];
  const what = (h: Hook) => EVENT_CHOICES.find((c) => JSON.stringify(c.events ?? null) === JSON.stringify(h.events ?? null))?.label ?? h.events?.join(', ') ?? 'Everything';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <header className="dialog-head">
          <span className="tag" id="connections-title">
            Connections
          </span>
          <button type="button" className="text-btn" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        {err && <em className="ed-error">{err}</em>}
        <h3 className="conn-head">Webhooks</h3>
        <p className="quiet conn-note">Every change, made here, by an agent or by a command, is posted to these addresses as CloudEvents, or as a chat line when an agent adds steps.</p>
        <ul className="designs-list">
          {hooks.map((h) => (
            <li key={h.id} className="designs-row">
              <span className="choice-main">
                <code className="conn-url" title={h.url}>
                  {h.url}
                </code>
                <span>
                  {h.format === 'chat' ? 'Chat message' : 'CloudEvents'} · {what(h)} · {h.designs?.length ? h.designs.join(', ') : 'all designs'}
                  {h.signed ? ' · signed' : ''}
                  {results[h.id] ? ` · ${results[h.id]}` : ''}
                </span>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => test(h)}>
                  Test
                </button>
                <button className="text-btn danger" onClick={() => run(() => api.removeHook(h.id))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
          {!hooks.length && <li className="designs-empty">No webhooks yet.</li>}
        </ul>
        <form className="conn-form" onSubmit={add}>
          <input className="find-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/… or your endpoint" aria-label="Webhook address" required />
          <select className="find-input" value={format} onChange={(e) => setFormat(e.target.value as 'cloudevents' | 'chat')} aria-label="Format">
            <option value="cloudevents">CloudEvents (JSON)</option>
            <option value="chat">Chat message (Slack, Teams, Discord)</option>
          </select>
          <select className="find-input" value={choice} onChange={(e) => setChoice(Number(e.target.value))} aria-label="Events">
            {EVENT_CHOICES.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </select>
          <input className="find-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Signing secret (optional, 8+ characters)" aria-label="Signing secret" autoComplete="new-password" />
          {design && (
            <label className="conn-check">
              <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only “{design.title}”
            </label>
          )}
          <button className="btn" type="submit" disabled={!url.trim() || (secret.length > 0 && secret.length < 8)}>
            Add webhook
          </button>
        </form>
        <h3 className="conn-head">MCP servers</h3>
        <p className="quiet conn-note">
          Servers you already run answer questions about a part in its panel. List them in <code>{mcp?.file}</code>, then restart. Only tools that declare themselves read-only are called.
        </p>
        {mcp?.error && <em className="ed-error">{mcp.error}</em>}
        <ul className="designs-list">
          {mcp?.servers.map((s) => (
            <li key={s.name} className="designs-row">
              <span className="choice-main">
                <strong>{s.name}</strong>
                <span>
                  {s.queries.length ? s.queries.join(', ') : 'No queries yet'}
                  {results[s.name] ? ` · ${results[s.name]}` : ''}
                </span>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => testMcp(s.name)}>
                  Test
                </button>
              </span>
            </li>
          ))}
          {!mcp?.servers.length && !mcp?.error && <li className="designs-empty">No MCP servers yet.</li>}
        </ul>
        <h3 className="conn-head">Plugins</h3>
        <p className="quiet conn-note">
          Add formats, metric sources and link targets by putting a <code>.mjs</code> module in <code>{plugins?.dir}</code>, then restart. Plugins run as code on this machine, so add only what you trust.
        </p>
        <ul className="designs-list">
          {plugins?.plugins.map((p) => (
            <li key={p.name} className="designs-row">
              <span className="choice-main">
                <strong>{p.name}</strong>
                <span>
                  {[
                    p.importers.length && `Reads ${p.importers.join(', ')}`,
                    p.exporters.length && `Exports ${p.exporters.map((x) => x.name).join(', ')}`,
                    p.metrics.length && `Live load from ${p.metrics.join(', ')}`,
                    p.links.length && `Opens ${p.links.join(', ')} links`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </li>
          ))}
          {plugins?.failed.map((f) => (
            <li key={f.file} className="designs-row">
              <span className="choice-main">
                <strong>{f.file}</strong>
                <em className="ed-error">{f.error}</em>
              </span>
            </li>
          ))}
          {!plugins?.plugins.length && !plugins?.failed.length && <li className="designs-empty">No plugins yet.</li>}
        </ul>
        <h3 className="conn-head">For other tools and agents</h3>
        <ul className="designs-list">
          {link && (
            <li className="designs-row">
              <span className="choice-main">
                <strong>Link to {selected ? 'the selection' : 'this design'}</strong>
                <code className="conn-url">{link}</code>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => copy('link', link)}>
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </button>
              </span>
            </li>
          )}
          {addresses.map(([name, value, note]) => (
            <li key={name} className="designs-row">
              <span className="choice-main">
                <strong>{name}</strong>
                <span>{note}</span>
                <code className="conn-url">{value}</code>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => copy(name, value)}>
                  {copied === name ? 'Copied' : 'Copy'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Not a valid design id, so no template can take it.
const MERMAID = ':mermaid';
const INFRA = ':infra';

function NewDesign({ templates, onCancel, onCreated }: { templates: Summary[]; onCancel: () => void; onCreated: (d: Design) => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('');
  const [source, setSource] = useState('');
  // The text whose unreadable lines the user was already told about; submitting it again goes ahead.
  const [warned, setWarned] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDismiss(true, onCancel);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Give the design a title.');
    if (!/[a-z0-9]/i.test(title)) return setErr('Use at least one letter or digit.');
    // Loaded only here, so the YAML parser stays out of the main bundle.
    const importer = template === MERMAID || template === INFRA ? await import('../core/importer.ts') : null;
    const id = m.slugify(title);
    let fill: ((d: Design) => void) | null = null;
    if (importer) {
      // Import into a draft first, so a paste that can't become a valid design never leaves an empty one behind.
      let left: string[];
      try {
        const text = await importer.unpack(source);
        const plugin = await api.readWithPlugin(text);
        if (!plugin && !importer.formatOf(text)) throw new Error('This isn’t a diagram or infrastructure file this can read.');
        fill = (d) => void importer.importText(d, text, { guess: guessType, plugin });
        const draft = m.blankDesign(id, title.trim());
        left = importer.importText(draft, text, { guess: guessType, plugin }).leftOut;
        parseDesign(draft);
      } catch (e) {
        return setErr(errorText(e));
      }
      if (left.length && warned !== source) {
        setWarned(source);
        return setErr(`Left out: ${left.join('; ')}. Create again to go ahead.`);
      }
    }
    setBusy(true);
    try {
      const created = await api.create({ id, title: title.trim(), template: fill ? undefined : template || undefined });
      if (fill) fill(created);
      onCreated(fill ? await api.save(created) : created);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? 'A design with this name already exists. Try another.' : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const options = [
    { id: '', title: 'Blank sheet', description: 'Nothing on it yet. Build it yourself or let an agent fill it in.', steps: 1, unseen: 0 },
    { id: MERMAID, title: 'Diagram from another tool', description: 'Paste Mermaid (flowchart, sequence, C4, architecture), C4-PlantUML, draw.io XML or a Structurizr workspace; boxes, arrows and groups become parts, lines and boundaries, a sequence or dynamic view a flow.', steps: 1, unseen: 0 },
    { id: INFRA, title: 'Infrastructure, catalogs, API specs or traces', description: 'Paste a compose file, manifests, "terraform show -json" output, a CloudFormation / CDK template, a Pulumi stack export, a Backstage catalog, an OpenAPI or AsyncAPI document, or OpenTelemetry / Jaeger traces; services, workloads and resources become parts, dependencies and calls become lines (traces add measured load, latency and flows).', steps: 1, unseen: 0 },
    ...templates,
  ];
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
              <span className="menu-meta">{t.id && t.id !== MERMAID && t.id !== INFRA ? `${pad(t.steps)} steps` : '—'}</span>
            </button>
          ))}
        </div>
        {(template === MERMAID || template === INFRA) && (
          <textarea
            className="ed mermaid-input"
            rows={8}
            value={source}
            placeholder={
              template === MERMAID
                ? 'flowchart LR\n  user((User)) --> api[Orders API]\n  api --> db[(Orders DB)]'
                : 'services:\n  api:\n    build: .\n    depends_on: [db]\n  db:\n    image: postgres:16'
            }
            aria-label={template === MERMAID ? 'Mermaid, C4-PlantUML, draw.io or Structurizr' : 'docker-compose, Kubernetes YAML, Terraform JSON, CloudFormation, Pulumi, Backstage, OpenAPI, AsyncAPI or trace JSON'}
            spellCheck={false}
            onChange={(e) => {
              setSource(e.target.value);
              setErr(null);
            }}
          />
        )}
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
