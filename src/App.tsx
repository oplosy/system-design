import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { api, type Me, type Plugins } from './api.ts';
import { boundaryAt } from './boundaries.ts';
import { EdgeContext, SketchContext, edgeTypes, nodeTypes } from './canvas.tsx';
import { type AddKind, AddMenu, DRAG_MIME } from './palette.tsx';
import type { FlowAt } from './fields.tsx';
import { errorText, MAX_IMPORT } from './format.ts';
import { type ExportKind, InlineEdit } from './menus.tsx';
import { CrashGuard } from './crash-guard.tsx';
import { Designs } from './designs.tsx';
import { PresentBar, ReviewBar, Trail } from './bars.tsx';
import { exportDesign } from './transfer.ts';
import { TopBar } from './topbar.tsx';
import { deriveSheet, withSelection } from './derive.ts';
import { addItem, connectItems, isAddKind, removeItems, sheetItems } from './sheet-edits.ts';
import { useArrange } from './use-arrange.ts';
import { useAutoFit } from './use-auto-fit.ts';
import { useClipboard } from './use-clipboard.ts';
import { useDesignNav } from './use-design-nav.ts';
import { useDesignStore } from './use-design-store.ts';
import { useInlineEdit } from './use-inline-edit.ts';
import { useLiveLoad } from './use-live-load.ts';
import { useMinimap, useSketch, useTheme } from './use-prefs.ts';
import { usePresenting } from './use-presenting.ts';
import { useSheetNodes } from './use-sheet-nodes.ts';
import { useShortcuts } from './use-shortcuts.ts';
import { useWalkthrough } from './use-walkthrough.ts';
import { Inspector, StepDetails } from './inspector.tsx';
import { NoDesigns } from './no-designs.tsx';
import { Icon } from './icons.tsx';

// Opened now and then, so they load on first use and leave the first paint lighter.
const Connections = lazy(() => import('./connections.tsx').then((x) => ({ default: x.Connections })));
const NewDesign = lazy(() => import('./new-design.tsx').then((x) => ({ default: x.NewDesign })));
const SequenceView = lazy(() => import('./sequence.tsx').then((x) => ({ default: x.SequenceView })));

/** Sheets at least this big draw only what is on screen; on smaller ones that would save nothing and cost a remount on every pan. */
const DRAW_VISIBLE_FROM = 100;

/** Waits until React Flow has drawn what a state change asked for. */
const nextPaint = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done))));

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = useDesignStore(setError);
  const { design, designRef, hist, change, settle } = store;
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  const [plugins, setPlugins] = useState<Plugins | null>(null);
  const [me, setMe] = useState<Me>(null);
  useEffect(() => void api.me().then(setMe, () => undefined), []);
  useEffect(() => void api.plugins().then(setPlugins, () => undefined), []);
  const pluginExports = useMemo(() => (plugins?.plugins ?? []).flatMap((p) => p.exporters.map((x) => ({ ...x, kind: `plugin:${x.key}` }))), [plugins]);
  // Show only parts with this tag (a view of the same model); null shows everything.
  const [tag, setTag] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const [presenting, setFullScreen] = usePresenting();
  const [theme, setTheme] = useTheme();
  const [sketch, setStyle] = useSketch();
  const [minimap, setMinimap] = useMinimap();
  const [flow, setFlow] = useState<FlowAt | null>(null);
  // Stops of a flow being drawn by clicking parts on the sheet.
  const [recording, setRecording] = useState<string[] | null>(null);
  // The flow shown as a sequence diagram over the sheet.
  const [sequence, setSequence] = useState<string | null>(null);
  // Which option of a step with options is on the sheet; its first until another is chosen.
  const [optionView, setOptionView] = useState<Record<string, string>>({});
  // A picture is made from the page, so it needs every node drawn, on screen or not.
  const [picturing, setPicturing] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();

  const walk = useWalkthrough({ design, change, setSelected, setError });
  const { view, maxIndex, current, setViewIndex, detailsOpen, goTo, seenNext } = walk;

  /** Shows an item of the open design: a step opens it, anything else opens its step and selects it. */
  const showItem = useCallback(
    (d: Design, item: string) => {
      const step = d.steps.findIndex((s) => s.id === item);
      if (step >= 0) return setViewIndex(step), setSelected(null);
      const x = [...d.components, ...d.connections, ...d.boundaries, ...d.notes, ...d.decisions, ...d.flows].find((i) => i.id === item);
      if (!x) return;
      setViewIndex(d.steps.findIndex((s) => s.id === x.step));
      setSelected(x.id);
    },
    [setViewIndex],
  );
  const onOpened = useCallback(
    (d: Design) => {
      setFlow(null);
      setSequence(null);
      const firstUnseen = d.steps.findIndex((s) => !s.seen);
      setViewIndex(firstUnseen >= 0 ? firstUnseen : d.steps.length - 1);
    },
    [setViewIndex],
  );
  const nav = useDesignNav({ store, selected, setSelected, setError, onOpened, showItem });
  const { live, liveOn, toggleLive } = useLiveLoad(design?.id, setError);

  const inOption = useCallback(
    (x: { step: string; option?: string }) => !x.option || x.option === (optionView[x.step] ?? design?.steps.find((s) => s.id === x.step)?.options?.[0].id),
    [optionView, design],
  );
  const derived = useMemo(
    () => deriveSheet({ design, current, view, diff, presenting, flow, recording, inOption, tag, live }),
    [design, current, view, diff, presenting, flow, recording, inOption, tag, live],
  );
  const sheet = useMemo(() => withSelection(derived, selected), [derived, selected]);
  const { nodes, onNodesChange, drag, selectNext, clearSelection } = useSheetNodes(sheet, selected, store);
  const { fitOpts, refit } = useAutoFit({ design, view, nodes, presenting, detailsOpen, canvasRef });
  const arrange = useArrange({ store, refit, setError });
  const { editing, startEdit, finishEdit, cancelEdit } = useInlineEdit(store, presenting);

  const remove = (ids: string[]) => change((d) => removeItems(d, ids));
  /** Removes items from the sheet along with the selection that was on them. */
  const discard = (ids: string[]) => {
    remove(ids);
    setSelected(null);
  };
  const selectedIds = () => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    return ids.length ? ids : selected ? [selected] : [];
  };
  const { duplicate, onClipKey, importSource } = useClipboard({
    store,
    active: !creating && !presenting,
    stepId: current?.id,
    selectedIds,
    remove: discard,
    selectPasted: (ids) => {
      selectNext(ids);
      setSelected(ids.length === 1 ? ids[0] : null);
    },
    showImported: (i) => {
      setSelected(null);
      setViewIndex(i);
    },
    setError,
  });

  const add = (kind: AddKind, at?: { x: number; y: number }) => {
    if (!current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = at ?? screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 });
    // Dropping onto a boundary puts the new part (or boundary) inside it.
    const inside = at ? boundaryAt(sheet.boxes, center) : undefined;
    let newId: string | null = null;
    change((d) => {
      newId = addItem(d, kind, { center, inside, step: current.id });
    });
    setSelected(newId);
    setAdding(false);
  };
  const onConnect = (c: FlowConnection) => current && change((d) => connectItems(d, c, current.id));
  const pickOption = (step: string, option: string) => {
    change((d) => m.pickOption(d, step, option));
    setSelected(null);
  };
  const undo = (back: boolean) => {
    if (store.undo(back)) setSelected(null);
  };

  const actions = {
    onOpen: (target: string, via: string) => void nav.drill(target, via),
    onBend: (id: string, bend: number | undefined) =>
      change((d) => {
        const c = d.connections.find((x) => x.id === id);
        if (c) c.bend = bend;
      }),
    onEditLabel: startEdit,
    onDelete: (id: string) => discard([id]),
  };
  // The context value stays the same across renders, or every node and line on the sheet would redraw with each one.
  const latestActions = useRef(actions);
  latestActions.current = actions;
  const edgeActions = useMemo(
    () => ({
      locked: presenting,
      onOpen: (target: string, via: string) => latestActions.current.onOpen(target, via),
      onBend: (id: string, bend: number | undefined) => latestActions.current.onBend(id, bend),
      onEditLabel: (id: string, at: { x: number; y: number }) => latestActions.current.onEditLabel(id, at),
      onDelete: (id: string) => latestActions.current.onDelete(id),
    }),
    [presenting],
  );

  // Drawing a flow clears any selection so clicks only add stops.
  const startRecording = (r: string[] | null) => {
    setFlow(null);
    setSelected(null);
    clearSelection();
    setRecording(r);
  };
  const present = (on: boolean) => {
    setFullScreen(on);
    setSelected(null);
    setRecording(null);
    cancelEdit();
  };
  const exportAs = async (kind: ExportKind) => {
    if (!design) return;
    const picture = kind === 'png' || kind === 'svg';
    if (picture) {
      setPicturing(true);
      await nextPaint();
    }
    try {
      await exportDesign(kind, {
        design,
        plugged: pluginExports.find((x) => x.kind === kind),
        settle,
        canvas: canvasRef.current,
        nodes: getNodes().filter((n) => !n.hidden),
        onError: setError,
      });
    } finally {
      setPicturing(false);
    }
  };
  const findPick = (id: string) => {
    const conn = designRef.current?.connections.find((c) => c.id === id);
    setSelected(id);
    void fitView({ nodes: conn ? [{ id: conn.from }, { id: conn.to }] : [{ id }], duration: 300, maxZoom: 1.2, padding: 0.6 });
  };

  useShortcuts({
    blocked: creating,
    presenting,
    design,
    view,
    selected,
    flow,
    setFlow,
    goTo,
    seenNext,
    present,
    undo,
    duplicate,
    onClipKey,
    onFind: () => {
      setFinding(true);
      findRef.current?.focus();
    },
    onAdd: () => setAdding(true),
    onEscape: () => {
      setSelected(null);
      setRecording(null);
      setSequence(null);
    },
  });

  const onDrop = (e: React.DragEvent) => {
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
  };
  const onNodeClick = (e: React.MouseEvent, n: Node) => {
    if (!recording) {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelected(n.id);
      return;
    }
    // Each stop must follow a connection from the last one.
    const last = recording.at(-1);
    if (n.type === 'component' && (!last || (last !== n.id && m.hopConnection(design!, last, n.id)))) setRecording([...recording, n.id]);
  };
  const flowPoint = (e: React.MouseEvent) => screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const isLine = (e: Edge) => e.data?.kind === 'flow';

  // A selected item swaps the step details for its own card.
  const focused = !!design && sheetItems(design).some((x) => x.id === selected);
  const sequenced = sequence ? design?.flows.find((x) => x.id === sequence) : undefined;

  return (
    <SketchContext.Provider value={sketch}>
      <div className={`app${presenting ? ' presenting' : ''}`}>
        <TopBar
          design={design}
          designs={nav.designs}
          currentId={nav.id}
          me={me}
          canUndo={!!hist.current.past.length}
          canRedo={!!hist.current.future.length}
          onUndo={undo}
          onFind={() => setFinding(true)}
          tag={tag}
          onTag={setTag}
          live={live}
          liveOn={liveOn}
          onLiveToggle={toggleLive}
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
          onPickDesign={nav.openTop}
          onBrowse={() => nav.setBrowsing(true)}
          onConnections={() => setConnecting(true)}
          find={design && finding ? { design, visible: nodes.filter((n) => !n.hidden).map((n) => n.id).concat(sheet.edges.map((e) => e.id)), onPick: findPick, inputRef: findRef, onClose: () => setFinding(false) } : null}
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
              onDrop={onDrop}
            >
              <CrashGuard key={design.id} title="This sheet could not be drawn" hint="The design is saved and was not changed. Open another design from the top bar, or try again.">
              <EdgeContext.Provider value={edgeActions}>
                <ReactFlow
                  key={design.id}
                  nodes={nodes}
                  edges={sheet.edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={onNodeClick}
                  onEdgeClick={(_, e) => isLine(e) && setSelected(e.id)}
                  onNodeDoubleClick={(e, n) => startEdit(n.id, flowPoint(e))}
                  onEdgeDoubleClick={(e, ed) => isLine(ed) && startEdit(ed.id, flowPoint(e))}
                  onPaneClick={() => setSelected(null)}
                  {...drag}
                  elevateNodesOnSelect={false}
                  onlyRenderVisibleElements={!picturing && nodes.length >= DRAW_VISIBLE_FROM}
                  onConnect={onConnect}
                  onDelete={({ nodes: ns, edges: es }) => remove([...ns.map((n) => n.id), ...es.filter(isLine).map((e) => e.id)])}
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
              </CrashGuard>
              {nav.trail.length > 0 && !presenting && <Trail trail={nav.trail} title={design.title} onBack={(i) => void nav.backTo(i)} />}
              {sequenced && !presenting && (
                <Suspense fallback={null}>
                  <SequenceView design={design} flow={sequenced} at={flow?.id === sequenced.id ? flow.at : undefined} onClose={() => setSequence(null)} />
                </Suspense>
              )}
              {presenting ? (
                <PresentBar design={design} viewIndex={view} maxIndex={maxIndex} onView={goTo} onExit={() => present(false)} flow={flow} onFlow={setFlow} />
              ) : (
                <ReviewBar
                  design={design}
                  viewIndex={view}
                  maxIndex={maxIndex}
                  onView={goTo}
                  onSeenNext={seenNext}
                  onRequestChanges={walk.requestChanges}
                  open={detailsOpen && !focused}
                  onToggle={() => {
                    setSelected(null);
                    walk.setDetailsOpen(focused || !detailsOpen);
                  }}
                >
                  <StepDetails design={design} stepId={current.id} diff={diff} onDiff={() => setDiff((x) => !x)} flow={flow} onFlow={setFlow} recording={recording} onRecording={startRecording} onSequence={setSequence} inOption={inOption} optionView={optionView} onOption={(s, o) => setOptionView((v) => ({ ...v, [s]: o }))} onPickOption={pickOption} change={change} onSelect={setSelected} />
                </ReviewBar>
              )}
            </div>
            {!presenting && <AddMenu open={adding} onOpen={setAdding} onAdd={(k) => add(k)} />}
            {!presenting && focused && (
              <div className="card">
                <Inspector design={design} selected={selected} stepId={current.id} inOption={inOption} designs={nav.designs} onOpenInside={(c) => void nav.drill(c.detail!, c.label)} onCreateInside={(c) => void nav.createInside(c)} change={change} onSelect={setSelected} onDelete={(x) => discard([x])} />
              </div>
            )}
          </div>
        ) : (
          nav.designs.length === 0 && <NoDesigns onCreate={() => setCreating(true)} onBrowse={() => nav.setBrowsing(true)} />
        )}

        <Suspense fallback={null}>
        {connecting && <Connections design={design} selected={selected} plugins={plugins} onClose={() => setConnecting(false)} />}
        {nav.browsing && (
          <Designs
            designs={nav.designs}
            current={nav.id}
            onClose={() => nav.setBrowsing(false)}
            onChanged={nav.refreshLists}
            onOpen={(x) => {
              nav.setBrowsing(false);
              nav.openTop(x);
              nav.refreshLists();
            }}
          />
        )}
        {creating && (
          <NewDesign
            templates={nav.templates}
            onCancel={() => setCreating(false)}
            onCreated={(d) => {
              setCreating(false);
              nav.refreshLists();
              nav.setId(d.id);
            }}
          />
        )}
        </Suspense>
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
