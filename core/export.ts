import type { ComponentType, Design } from './schema.ts';

// Text exports: a Mermaid flowchart of the design and a Markdown record of its decisions.

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
    const arrow = c.async ? '-.->' : '-->';
    out.push(`  ${mid(c.from)} ${arrow}${c.label ? `|${text(c.label)}|` : ''} ${mid(c.to)}`);
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
