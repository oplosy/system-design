import type { ComponentType, Design } from './schema.ts';

/** A likely design smell on one item. Advisory: the reviewer or agent decides whether it matters. */
export type Issue = { id: string; rule: string; message: string };

const DATASTORES = new Set<ComponentType>(['sql-db', 'nosql-db', 'key-value', 'cache', 'graph-db', 'time-series', 'vector-db', 'search', 'warehouse', 'data-lake', 'olap', 'ledger']);
const CLIENTS = new Set<ComponentType>(['user', 'client', 'mobile', 'iot', 'desktop-app', 'ui']);
const MESSAGING = new Set<ComponentType>(['queue', 'pubsub', 'stream', 'event-bus', 'mqtt']);
const BALANCERS = new Set<ComponentType>(['load-balancer', 'reverse-proxy']);

export function lint(d: Design): Issue[] {
  const out: Issue[] = [];
  const type = new Map(d.components.map((c) => [c.id, c.type]));
  const neighbours = new Map(d.components.map((c) => [c.id, new Set<string>()]));
  for (const c of d.connections) {
    neighbours.get(c.from)!.add(c.to);
    neighbours.get(c.to)!.add(c.from);
  }
  const boundary = new Map(d.boundaries.map((b) => [b.id, b]));
  const inPublicNetwork = (id: string | undefined) => {
    for (let b = id && boundary.get(id), hops = 0; b && hops <= d.boundaries.length; b = b.parent && boundary.get(b.parent), hops++) {
      if (/\b(public|dmz)\b/i.test(b.label)) return true;
    }
    return false;
  };

  for (const c of d.components) {
    const near = neighbours.get(c.id)!;
    if (!near.size && d.connections.length) out.push({ id: c.id, rule: 'isolated', message: 'Not connected to anything.' });
    if (BALANCERS.has(c.type)) {
      const targets = d.connections.filter((x) => x.from === c.id).length;
      if (targets === 1) out.push({ id: c.id, rule: 'single-target', message: 'Balances a single target: that target is a single point of failure.' });
    }
    if (MESSAGING.has(c.type) && near.size === 1) out.push({ id: c.id, rule: 'one-sided', message: 'Only one side is connected: who produces and who consumes?' });
    if (DATASTORES.has(c.type)) {
      if (inPublicNetwork(c.boundary)) out.push({ id: c.id, rule: 'public-datastore', message: 'Datastore sits in a public network.' });
      if ([...near].some((n) => CLIENTS.has(type.get(n)!))) out.push({ id: c.id, rule: 'client-to-datastore', message: 'Clients reach this datastore directly, with no service in between.' });
    }
  }
  for (const c of d.components) {
    const { load, capacity } = loadOf(d, c.id);
    if (capacity === undefined || capacity === 0 || load === 0) continue;
    const pct = Math.round((load / capacity) * 100);
    if (load > capacity) out.push({ id: c.id, rule: 'over-capacity', message: `Gets ${load} req/s against a capacity of ${capacity} (${pct}%).` });
    else if (load >= 0.8 * capacity) out.push({ id: c.id, rule: 'near-capacity', message: `Gets ${load} req/s, ${pct}% of its capacity of ${capacity}.` });
  }
  for (const x of d.decisions) if (!x.links.length) out.push({ id: x.id, rule: 'unlinked-decision', message: 'Decision is not linked to any component.' });
  return out;
}

/** Requests per second on the lines into a part (lines without qps count as 0), next to what it can take. */
export function loadOf(d: Design, id: string) {
  const load = d.connections.filter((x) => x.to === id).reduce((t, x) => t + (x.qps ?? 0), 0);
  return { load, capacity: d.components.find((c) => c.id === id)?.capacity };
}

/**
 * What breaks when a part goes down: the flows that pass through it, and the parts no entry point (users,
 * clients, or parts nothing calls) can reach any more along the lines, though they could before.
 */
export function failureImpact(d: Design, id: string) {
  const entries = d.components.filter((c) => CLIENTS.has(c.type)).map((c) => c.id);
  const starts = entries.length ? entries : d.components.filter((c) => !d.connections.some((x) => x.to === c.id)).map((c) => c.id);
  const reach = (without?: string) => {
    const seen = new Set(starts.filter((s) => s !== without));
    for (const at of seen) for (const x of d.connections) if (x.from === at && x.to !== without) seen.add(x.to);
    return seen;
  };
  const before = reach();
  const after = reach(id);
  const label = (x: string) => d.components.find((c) => c.id === x)?.label ?? x;
  return {
    flows: d.flows.filter((f) => f.path.includes(id)).map((f) => f.title),
    cutOff: [...before].filter((x) => x !== id && !after.has(x)).map(label),
  };
}
