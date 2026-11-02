import type { Node } from '@xyflow/react';
import { codeUrl, costAt } from '../core/export.ts';
import { lint } from '../core/lint.ts';
import * as m from '../core/mutations.ts';
import type { ComponentType, Design } from '../core/schema.ts';
import type { LiveLoad } from './api.ts';
import { boundaryBoxes } from './boundaries.ts';
import type { FlowEdge } from './canvas.tsx';
import type { FlowAt } from './fields.tsx';
import { SHAPES } from './shapes.ts';

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

export type SheetInput = {
  design: Design | null;
  current: Design['steps'][number] | undefined;
  view: number;
  selected: string | null;
  diff: boolean;
  presenting: boolean;
  flow: FlowAt | null;
  recording: string[] | null;
  /** Whether an item of a step with options belongs to the option on the sheet. */
  inOption: (x: { step: string; option?: string }) => boolean;
  tag: string | null;
  live: LiveLoad | null;
};

/** The nodes, lines and boundary boxes the sheet shows for the open design at the step in view. */
export function deriveSheet({ design, current, view, selected, diff, presenting, flow, recording, inOption, tag, live }: SheetInput) {
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
}
