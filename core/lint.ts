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
  for (const x of d.decisions) if (!x.links.length) out.push({ id: x.id, rule: 'unlinked-decision', message: 'Decision is not linked to any component.' });
  return out;
}
