import { parseAllDocuments } from 'yaml';
import type { BoundaryKind, ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';
import { readSpans, readTraces, type TraceFlow } from './traces.ts';
import { asyncapi, backstage, isBackstage, openapi } from './specs.ts';
import { CFN_TAGS, cloudformation, pulumi, terraform } from './infra-cloud.ts';

// Reads a docker-compose file, Kubernetes manifests or an MCP client config into parts, lines and boundaries, and tells
// each format apart (cloud tools in infra-cloud.ts, service specs and catalogs in specs.ts).
// Lines come from depends_on/links, Ingress backends and environment values that name another part's host.

export type Part = { key: string; label: string; image?: string; type: ComponentType; tech?: string; description?: string; group?: string; code?: string };
export type Link = { from: string; to: string; label?: string; qps?: number; latency?: number; async?: boolean };
export type Group = { key: string; label: string; kind: BoundaryKind; parent?: string };
// biome-ignore lint/suspicious/noExplicitAny: a foreign file, read defensively field by field
export type Doc = Record<string, any>;

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

// Variable names whose value is an address, e.g. DB_HOST, API_URL, KAFKA_BOOTSTRAP_SERVERS.
const ADDRESS_KEY = /(host|hosts|url|urls|uri|addr|address|endpoint|server|servers|dsn|broker|brokers|upstream)$/i;

/**
 * Hosts an environment variable names. A value counts when it reads as an address (a URL, host:port, a cluster
 * DNS name) or the variable's name says it is one, so MODE=api does not link to a service called api.
 */
function hosts([key, value]: [string, unknown]) {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .flatMap((v) => {
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
      const authority = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').split(/[/?#]/)[0];
      const host = authority.replace(/:\d+$/, '');
      const address = url || host !== authority || /\.svc(\.|$)/.test(host) || ADDRESS_KEY.test(key);
      return address && /^[a-z0-9][a-z0-9.-]*$/i.test(host) ? [host] : [];
    });
}

function envEntries(env: unknown): [string, unknown][] {
  if (Array.isArray(env)) return env.map((e) => (typeof e === 'string' ? [e.split('=')[0], e.split('=').slice(1).join('=')] : [String(obj(e).name ?? ''), obj(e).value]));
  return Object.entries(obj(env));
}

export function readInfra(text: string) {
  if (/^\s*(resource|module|provider)\s+"/m.test(text)) throw new Error('This looks like Terraform source. Run "terraform show -json" (or on a saved plan) and paste its output.');
  const spans = readSpans(text);
  if (spans) {
    const { parts, links, flows }: { parts: Part[]; links: Link[]; flows: TraceFlow[] } = readTraces(spans);
    return { format: 'otel', parts, links, flows, groups: [] as Group[], skipped: [] as string[] };
  }
  if (/\{\{.*\}\}/.test(text)) throw new Error('This looks like a Helm template. Render it with "helm template <chart>" and paste the output.');
  const docs = Array.from(parseAllDocuments(text, { customTags: CFN_TAGS }));
  for (const doc of docs) if (doc.errors.length) throw new Error(`YAML: ${doc.errors[0].message}`);
  const values = docs.map((doc) => obj(doc.toJS())).flatMap((v) => (v.kind === 'List' ? list(v.items).map(obj) : [v]));
  if (values.length === 1 && values[0].format_version && (values[0].values || values[0].planned_values)) return { format: 'terraform', ...terraform(values[0]) };
  if (values.length === 1 && Object.values(obj(values[0].Resources)).some((r) => /^AWS::/.test(String(obj(r).Type)))) return { format: 'cloudformation', ...cloudformation(values[0]) };
  if (values.length === 1 && Array.isArray(obj(values[0].deployment).resources)) return { format: 'pulumi', ...pulumi(values[0]) };
  if (values.length === 1 && (typeof values[0].openapi === 'string' || values[0].swagger)) return { format: 'openapi', ...openapi(values[0]) };
  if (values.length === 1 && values[0].asyncapi) return { format: 'asyncapi', ...asyncapi(values[0]) };
  if (values.length === 1 && Object.keys(obj(values[0].mcpServers)).length) return { format: 'mcp', ...mcpConfig(values[0]) };
  if (values.length === 1 && Object.keys(obj(values[0].services)).length) return { format: 'compose', ...compose(values[0]) };
  // Backstage entities have a kind: too, so they go before Kubernetes.
  if (isBackstage(values)) return { format: 'backstage', ...backstage(values) };
  if (values.some((v) => typeof v.kind === 'string')) return { format: 'kubernetes', ...kube(values) };
  throw new Error(
    'Paste a docker-compose file (with services:), Kubernetes manifests (with kind:), "terraform show -json" output, a CloudFormation or CDK template, a Pulumi stack export, a Backstage catalog, an MCP client config (.mcp.json), an OpenAPI or AsyncAPI document, or OpenTelemetry (OTLP JSON) or Jaeger traces.',
  );
}

/** Images and names that say a part is an MCP server: Docker's "mcp/github" namespace, or "...-mcp-server". */
const MCP_IMAGE = /(^|\/)mcp\/|mcp[-_]server/i;
const mcpOr = (type: ComponentType, ...names: (string | undefined)[]): ComponentType => (names.some((n) => n && MCP_IMAGE.test(n)) ? 'mcp-server' : type);

/**
 * Reads an MCP client config (.mcp.json, mcp-servers.json): each entry under mcpServers is an MCP server. Env values and
 * headers hold tokens and arguments can hold connection strings, so only a package-like argument, the command or the
 * host of the address is kept.
 */
function mcpConfig(file: Doc) {
  const parts: Part[] = Object.entries(obj(file.mcpServers)).map(([key, s]) => {
    const arg = list(obj(s).args).find((a): a is string => typeof a === 'string' && /^[@\w][\w@./-]*$/.test(a));
    const host = str(obj(s).url) && URL.canParse(String(obj(s).url)) ? new URL(String(obj(s).url)).host : undefined;
    return { key, label: key, type: 'mcp-server', tech: host ?? arg ?? str(obj(s).command) };
  });
  return { parts, links: [] as Link[], groups: [] as Group[], skipped: [] as string[] };
}

function compose(file: Doc) {
  const services = obj(file.services);
  const names = Object.keys(services);
  const nets = (s: Doc) => (Array.isArray(s.networks) ? s.networks.map(String) : Object.keys(obj(s.networks)));
  const used = new Set(names.flatMap((n) => nets(obj(services[n])).slice(0, 1)));
  const links: Link[] = [];
  const parts: Part[] = names.map((key) => {
    const s = obj(services[key]);
    const deps = Array.isArray(s.depends_on) ? s.depends_on.map(String) : Object.keys(obj(s.depends_on));
    for (const to of [...deps, ...list(s.links).map((l) => String(l).split(':')[0])]) links.push({ from: key, to });
    for (const to of envEntries(s.environment).flatMap(hosts)) if (names.includes(to)) links.push({ from: key, to });
    const image = typeof s.image === 'string' ? s.image : undefined;
    // build is a context path, or { context } in the long form.
    const build = typeof s.build === 'string' ? s.build : obj(s.build).context;
    const code = typeof build === 'string' ? build : undefined;
    return { key, label: key, image, type: mcpOr('service', image, key), group: used.size > 1 ? nets(s)[0] : undefined, code };
  });
  const groups: Group[] = used.size > 1 ? [...used].map((n) => ({ key: n, label: n, kind: 'subnet' })) : [];
  return { parts, links, groups, skipped: [] as string[] };
}

/** Where each workload kind keeps its pod template ({ metadata, spec }), and the part type it gets when its image says nothing. */
const WORKLOADS: Record<string, [(d: Doc) => Doc, ComponentType]> = {
  Pod: [(d) => d, 'service'],
  Deployment: [(d) => obj(obj(d.spec).template), 'service'],
  StatefulSet: [(d) => obj(obj(d.spec).template), 'service'],
  DaemonSet: [(d) => obj(obj(d.spec).template), 'service'],
  ReplicaSet: [(d) => obj(obj(d.spec).template), 'service'],
  Job: [(d) => obj(obj(d.spec).template), 'worker'],
  CronJob: [(d) => obj(obj(obj(obj(d.spec).jobTemplate).spec).template), 'cron'],
};

function kube(docs: Doc[]) {
  const ns = (d: Doc) => String(obj(d.metadata).namespace ?? 'default');
  const name = (d: Doc) => String(obj(d.metadata).name ?? '');
  const parts: Part[] = [];
  const pods: { key: string; ns: string; labels: Doc; containers: Doc[] }[] = [];
  for (const d of docs) {
    const w = WORKLOADS[d.kind];
    if (!w || !name(d)) continue;
    const template = w[0](d);
    const containers = list(obj(template.spec).containers).map(obj);
    const key = `${ns(d)}/${d.kind}/${name(d)}`;
    const image = containers.map((c) => c.image).find((i) => typeof i === 'string');
    parts.push({ key, label: name(d), image, type: mcpOr(w[1], image, name(d)), group: ns(d) });
    pods.push({ key, ns: ns(d), labels: obj(obj(template.metadata).labels), containers });
  }
  // A Service is not a part of its own: it names the workloads its selector picks.
  const services = docs
    .filter((d) => d.kind === 'Service' && name(d))
    .map((d) => {
      const selector = Object.entries(obj(obj(d.spec).selector));
      const targets = pods.filter((p) => p.ns === ns(d) && selector.length && selector.every(([k, v]) => p.labels[k] === v)).map((p) => p.key);
      return { name: name(d), ns: ns(d), targets };
    });
  const namespaces = new Set(docs.map(ns));
  const resolve = (host: string, from: string) => {
    const [svc, hint] = host.split('.');
    const at = hint && namespaces.has(hint) ? hint : from;
    const found = services.filter((s) => s.name === svc);
    return (found.find((s) => s.ns === at) ?? found[0])?.targets ?? [];
  };
  const links: Link[] = [];
  for (const p of pods) {
    for (const host of p.containers.flatMap((c) => envEntries(c.env)).flatMap(hosts)) {
      for (const to of resolve(host, p.ns)) if (to !== p.key) links.push({ from: p.key, to });
    }
  }
  for (const d of docs.filter((x) => x.kind === 'Ingress' && name(x))) {
    const key = `${ns(d)}/Ingress/${name(d)}`;
    parts.push({ key, label: name(d), type: 'load-balancer', tech: 'Ingress', group: ns(d) });
    const spec = obj(d.spec);
    const backend = (b: unknown) => String(obj(obj(b).service).name ?? obj(b).serviceName ?? '');
    const routes = [
      { svc: backend(spec.defaultBackend ?? spec.backend), label: undefined as string | undefined },
      ...list(spec.rules).flatMap((r) =>
        list(obj(obj(r).http).paths).map((p) => ({ svc: backend(obj(p).backend), label: `${obj(r).host ?? ''}${obj(p).path ?? ''}` || undefined })),
      ),
    ];
    for (const r of routes) if (r.svc) for (const to of resolve(r.svc, ns(d))) links.push({ from: key, to, label: r.label });
  }
  const many = new Set(parts.map((p) => p.group)).size > 1;
  for (const p of parts) if (!many) p.group = undefined;
  const groups: Group[] = many ? [...new Set(parts.map((p) => p.group!))].map((n) => ({ key: n, label: n, kind: 'group' })) : [];
  // Everything that drew nothing, so the reader knows what was left out. Services show through their workloads.
  const skipped = docs.filter((d) => !WORKLOADS[d.kind] && !['Service', 'Ingress', 'Namespace'].includes(d.kind)).map((d) => `${d.kind ?? 'unknown kind'} ${name(d)}`.trim());
  return { parts, links, groups, skipped };
}

/**
 * Adds a compose file, manifests or Terraform JSON to `step` of a design. `guess` may pick a type from a part's image
 * and name (e.g. "postgres:16" → SQL DB) for parts that would otherwise be plain services. Each part it adds keeps
 * where it came from (`source`). With `sync`, parts the design already has are reused (same source, else same id or
 * label, which then gets the source), lines it already draws either way are kept, and parts once imported from this
 * format that the infrastructure no longer has are removed, so the design comes to match. Returns what changed.
 */
export function importInfra(
  d: Design,
  text: string,
  { step, guess, sync, reuse }: { step?: string; guess?: (words: string) => ComponentType | undefined; sync?: boolean; reuse?: boolean } = {},
) {
  const read = readInfra(text);
  const { format, parts, links, groups } = read;
  const flows: TraceFlow[] = ('flows' in read && read.flows) || [];
  if (!parts.length) throw new Error('No services or workloads found.');
  const at = { step, reopen: false };
  const byName = <T extends { id: string; label: string }>(label: string, items: T[]) => items.find((x) => x.id === m.slugify(label) || m.slugify(x.label) === m.slugify(label));
  const added = { components: [] as string[], connections: [] as string[], boundaries: [] as string[], removed: [] as string[], updated: [] as string[], described: [] as string[], flows: [] as string[] };
  const boundaryIds = new Map<string, string>();
  // Parents come first in groups, so a nested boundary finds its parent's id.
  for (const g of groups) {
    const found = (sync || reuse) && byName(g.label, d.boundaries)?.id;
    if (!found) added.boundaries.push(g.label);
    boundaryIds.set(g.key, found || m.addBoundary(d, { kind: g.kind, label: g.label, id: g.key, parent: g.parent && boundaryIds.get(g.parent), ...at }));
  }
  const ids = new Map<string, string>();
  for (const p of parts) {
    const source = `${format}:${p.key}`;
    // In a sync a part that came from somewhere else is a different thing, even with the same name; a paste
    // reuses any part of that name, so an OpenAPI document lands on the service already drawn.
    const found = sync || reuse ? (d.components.find((c) => c.source === source) ?? byName(p.label, sync ? d.components.filter((c) => !c.source) : d.components)) : undefined;
    if (found) {
      found.source ??= source;
      ids.set(p.key, found.id);
      // A description the design lacks (an API's endpoints, a catalog entry's) is filled in, never overwritten.
      if (p.description && !found.description) {
        m.updateTracked(d, found.id, { description: p.description }, step, false);
        added.described.push(found.label);
      }
      continue;
    }
    // "registry.io/team/postgres:16@sha256:…" → "postgres:16"
    const tech = p.tech ?? p.image?.split('@')[0].split('/').pop();
    // A part with a known tech (Terraform resource, Ingress) already has its type; only image-based parts need a guess.
    const type = (p.type === 'service' && !p.tech && guess?.(`${tech?.split(':')[0] ?? ''} ${p.label}`)) || p.type;
    ids.set(p.key, m.addComponent(d, { id: p.label, type, label: p.label, tech, description: p.description, code: p.code, source, boundary: p.group && boundaryIds.get(p.group), ...at }));
    added.components.push(p.label);
  }
  const label = (id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  // Measured load and latency (from traces) replace what a line says only when it is missing or off by more than a quarter.
  const off = (was: number | undefined, now: number | undefined) => now !== undefined && (was === undefined || Math.abs(now - was) > 0.25 * Math.max(was, 1));
  for (const l of links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to || from === to) continue;
    const drawn = d.connections.find((c) => c.from === from && c.to === to) ?? d.connections.find((c) => c.from === to && c.to === from);
    if (!drawn) {
      m.connect(d, { from, to, label: l.label, qps: l.qps, latency: l.latency, async: l.async, ...at });
      added.connections.push(`${label(from)} → ${label(to)}`);
    } else if (drawn.from === from && (off(drawn.qps, l.qps) || off(drawn.latency, l.latency))) {
      m.updateTracked(d, drawn.id, { qps: off(drawn.qps, l.qps) ? l.qps : drawn.qps, latency: off(drawn.latency, l.latency) ? l.latency : drawn.latency }, step, false);
      added.updated.push(`${label(from)} → ${label(to)}: ${[l.qps !== undefined && `${l.qps} req/s`, l.latency !== undefined && `${l.latency} ms`].filter(Boolean).join(', ')}`);
    }
  }
  for (const f of flows) {
    const path = f.path.map((k) => ids.get(k)!);
    // A hop the traces imply but no line carries (a consumer reached without a producer span) would break the flow; leave it out.
    if (d.flows.some((x) => x.title === f.title) || !path.every((p, i) => i === 0 || m.hopConnection(d, path[i - 1], p))) continue;
    m.addFlow(d, { title: f.title, path, ...at });
    added.flows.push(f.title);
  }
  // Traces are a sample: a service missing from them has not necessarily gone.
  if (sync && format !== 'otel') {
    // Only parts this format put there: a hand-drawn part, or one from another file type, is not the infrastructure's to remove.
    const keys = new Set(parts.map((p) => `${format}:${p.key}`));
    for (const c of d.components.filter((x) => x.source?.startsWith(`${format}:`) && !keys.has(x.source))) {
      added.removed.push(c.label);
      if (step) m.removeTracked(d, c.id, step);
      else m.removeItem(d, c.id);
    }
  }
  return added;
}

/** What `text` has that design `d` lacks, and the imported parts it no longer has, without changing `d`. */
export function infraDrift(d: Design, text: string, guess?: (words: string) => ComponentType | undefined) {
  const added = importInfra(structuredClone(d), text, { sync: true, guess });
  return { ...added, drifted: Object.values(added).some((x) => x.length > 0) };
}

/** Brings `d` in line with `text` as one new, unseen step for review. Returns the step id, or undefined when nothing differs. */
export function syncInfra(d: Design, text: string, title: string, guess?: (words: string) => ComponentType | undefined) {
  const drift = infraDrift(d, text, guess);
  if (!drift.drifted) return undefined;
  const found = [...drift.components, ...drift.connections, ...drift.boundaries];
  const summary = [
    found.length && `Found in the infrastructure but not in the design: ${found.join(', ')}.`,
    drift.removed.length && `No longer in the infrastructure: ${drift.removed.join(', ')}.`,
    drift.updated.length && `Measured load and latency: ${drift.updated.join('; ')}.`,
    drift.described.length && `Descriptions filled in: ${drift.described.join(', ')}.`,
    drift.flows.length && `Flows seen in traces: ${drift.flows.join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const step = m.addStep(d, { title, summary });
  importInfra(d, text, { step, sync: true, guess });
  return step;
}
