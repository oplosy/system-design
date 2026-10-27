import type { ComponentType, Design, Flow } from './schema.ts';

// Text exports: a Mermaid flowchart of the design, Mermaid sequence diagrams of its flows and a Markdown record of its decisions.

const RESERVED = new Set(['end', 'graph', 'subgraph', 'style', 'class', 'click', 'flowchart', 'direction']);
const mid = (id: string) => (RESERVED.has(id) ? `${id}_` : id.replace(/-/g, '_'));
const text = (s: string) => `"${s.replace(/"/g, '#quot;').replace(/\n/g, ' ')}"`;

const CYLINDER: ComponentType[] = ['sql-db', 'nosql-db', 'key-value', 'cache', 'graph-db', 'time-series', 'vector-db', 'warehouse', 'data-lake', 'nas'];
const STADIUM: ComponentType[] = ['queue', 'pubsub', 'stream', 'event-bus'];
const HEXAGON: ComponentType[] = ['api-gateway', 'load-balancer', 'reverse-proxy', 'router', 'switch', 'l3-switch'];
const CIRCLE: ComponentType[] = ['user', 'internet'];

function shape(type: ComponentType, label: string) {
  if (CYLINDER.includes(type)) return `[(${label})]`;
  if (STADIUM.includes(type)) return `([${label}])`;
  if (HEXAGON.includes(type)) return `{{${label}}}`;
  if (CIRCLE.includes(type)) return `((${label}))`;
  if (type === 'external' || type === 'payment') return `[/${label}/]`;
  return `[${label}]`;
}

export function toMermaid(d: Design) {
  const out = [`%% ${d.title}`, 'flowchart LR'];
  const write = (parent: string | undefined, indent: string) => {
    for (const b of d.boundaries.filter((x) => x.parent === parent)) {
      out.push(`${indent}subgraph ${mid(b.id)}[${text(b.detail ? `${b.label} · ${b.detail}` : b.label)}]`);
      write(b.id, `${indent}  `);
      out.push(`${indent}end`);
    }
    for (const c of d.components.filter((x) => x.boundary === parent)) {
      out.push(`${indent}${mid(c.id)}${shape(c.type, text(c.tech ? `${c.label} (${c.tech})` : c.label))}`);
    }
  };
  write(undefined, '  ');
  for (const c of d.connections) {
    const arrow = c.async || c.kind === 'implementation' || c.kind === 'include' || c.kind === 'extend' ? '-.->' : '-->';
    out.push(`  ${mid(c.from)} ${arrow}${c.label ? `|${text(c.label)}|` : ''} ${mid(c.to)}`);
  }
  return out.join('\n') + '\n';
}

/**
 * A flow as a sequence diagram: participants in order of first visit, one message per hop.
 * A hop against its connection's direction is a reply; a hop along an async connection is async.
 */
export function flowSequence(d: Design, flow: Flow) {
  const participants = [...new Set(flow.path)].flatMap((id) => d.components.filter((c) => c.id === id));
  const messages = flow.path.slice(1).map((to, i) => {
    const from = flow.path[i];
    const c = d.connections.find((x) => (x.from === from && x.to === to) || (x.from === to && x.to === from));
    return { from, to, label: c?.label, latency: c?.latency, reply: !!c && c.from === to, async: !!c?.async, missing: !c };
  });
  return { participants, messages };
}

/** Total time of a flow from its lines' latencies; `unknown` counts hops whose line has none. */
export function flowLatency(d: Design, flow: Flow) {
  const { messages } = flowSequence(d, flow);
  return { total: messages.reduce((t, m) => t + (m.latency ?? 0), 0), unknown: messages.filter((m) => m.latency === undefined).length };
}

/**
 * How much a step moves the monthly cost: the parts it adds (those `show` keeps) at the cost they had when it ended,
 * the cost edits it records and the parts it removes. The changes of all steps add up to the design's current total.
 */
export function stepCostChange(d: Design, stepId: string, show: (x: { step: string; option?: string }) => boolean = () => true) {
  const k = d.steps.findIndex((x) => x.id === stepId);
  const s = d.steps[k];
  if (!s) return 0;
  const later = d.steps.slice(k + 1);
  const removedIn = (t: Design['steps'][number]) => new Set(t.removed?.map((r) => r.id));
  const snapshots = (t: Design['steps'][number]) => (t.before ?? []).filter((b) => b.kind === 'components' && removedIn(t).has(String(b.item.id))).map((b) => b.item as { id: string; step: string; option?: string; cost?: number });
  // What the step added: parts still here, and parts a later step removed, as that step's snapshot keeps them.
  const added = [...d.components.filter((c) => c.step === stepId), ...later.flatMap(snapshots).filter((c) => c.step === stepId)].filter(show);
  // A later cost edit remembers the value this step left.
  const costOf = (c: { id: string; cost?: number }) => {
    const edit = later.map((t) => t.changed?.find((x) => x.id === c.id && x.field === 'cost')).find(Boolean);
    return edit ? Number(edit.from ?? 0) : (c.cost ?? 0);
  };
  const gone = removedIn(s);
  const edited = (s.changed ?? []).filter((c) => c.field === 'cost' && !gone.has(c.id)).reduce((t, c) => t + Number(c.to ?? 0) - Number(c.from ?? 0), 0);
  const removed = snapshots(s).reduce((t, c) => t + (c.cost ?? 0), 0);
  return added.reduce((t, c) => t + costOf(c), 0) + edited - removed;
}

export const dollars = (n: number) => `$${n.toLocaleString('en-US', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function toMermaidSequence(d: Design, flow: Flow) {
  const { participants, messages } = flowSequence(d, flow);
  const out = ['sequenceDiagram', `  title ${flow.title.replace(/\n/g, ' ')}`, '  autonumber'];
  for (const p of participants) out.push(`  participant ${mid(p.id)} as ${p.label.replace(/[\n;:]/g, ' ')}`);
  for (const x of messages) {
    const arrow = x.reply ? '-->>' : x.async ? '-)' : '->>';
    out.push(`  ${mid(x.from)}${arrow}${mid(x.to)}: ${(x.label ?? (x.reply ? 'reply' : 'call')).replace(/[\n;]/g, ' ')}`);
  }
  return out.join('\n') + '\n';
}

export function toDecisionRecord(d: Design) {
  const label = (id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  const out = [`# ${d.title}: decisions`, ''];
  if (d.description) out.push(d.description, '');
  if (!d.decisions.length) out.push('No decisions recorded yet.', '');
  d.decisions.forEach((x, i) => {
    const n = d.steps.findIndex((s) => s.id === x.step);
    out.push(`## D${i + 1}. ${x.title}`, '');
    out.push(`- **Step:** ${String(n + 1).padStart(2, '0')} · ${d.steps[n]?.title ?? x.step}`);
    if (x.links.length) out.push(`- **Affects:** ${x.links.map(label).join(', ')}`);
    out.push('', `**Why.** ${x.why}`, '');
    if (x.alternatives?.length) out.push('**Alternatives considered.**', '', ...x.alternatives.map((a) => `- ${a}`), '');
    if (x.tradeoffs) out.push(`**Trade-offs.** ${x.tradeoffs}`, '');
  });
  return out.join('\n');
}
