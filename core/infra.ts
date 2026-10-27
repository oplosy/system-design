import { parseAllDocuments } from 'yaml';
import type { BoundaryKind, ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';

// Reads a docker-compose file or Kubernetes manifests into parts, lines and boundaries.
// Lines come from depends_on/links, Ingress backends and environment values that name another part's host.

type Part = { key: string; label: string; image?: string; type: ComponentType; tech?: string; group?: string; code?: string };
type Link = { from: string; to: string; label?: string };
type Group = { key: string; label: string; kind: BoundaryKind };
type Doc = Record<string, any>;

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Hostnames an environment value may name: "postgres://u:p@db:5432/x, redis" → db, 5432, x, redis. */
function hosts(value: unknown) {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .flatMap((v) => v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').match(/[a-z0-9][a-z0-9.-]*/gi) ?? []);
}

function envValues(env: unknown) {
  if (Array.isArray(env)) return env.map((e) => (typeof e === 'string' ? e.split('=').slice(1).join('=') : obj(e).value));
  return Object.values(obj(env));
}

export function readInfra(text: string) {
  const docs = Array.from(parseAllDocuments(text));
  for (const doc of docs) if (doc.errors.length) throw new Error(`YAML: ${doc.errors[0].message}`);
  const values = docs.map((doc) => obj(doc.toJS())).flatMap((v) => (v.kind === 'List' ? list(v.items).map(obj) : [v]));
  if (values.length === 1 && Object.keys(obj(values[0].services)).length) return compose(values[0]);
  if (values.some((v) => typeof v.kind === 'string')) return kube(values);
  throw new Error('Paste a docker-compose file (with services:) or Kubernetes manifests (with kind:).');
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
    for (const to of envValues(s.environment).flatMap(hosts)) if (names.includes(to)) links.push({ from: key, to });
    const image = typeof s.image === 'string' ? s.image : undefined;
    // build is a context path, or { context } in the long form.
    const build = typeof s.build === 'string' ? s.build : obj(s.build).context;
    const code = typeof build === 'string' ? build : undefined;
    return { key, label: key, image, type: 'service', group: used.size > 1 ? nets(s)[0] : undefined, code };
  });
  const groups: Group[] = used.size > 1 ? [...used].map((n) => ({ key: n, label: n, kind: 'subnet' })) : [];
  return { parts, links, groups };
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
    parts.push({ key, label: name(d), image, type: w[1], group: ns(d) });
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
    for (const host of p.containers.flatMap((c) => envValues(c.env)).flatMap(hosts)) {
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
  return { parts, links, groups };
}

/**
 * Adds a compose file or manifests to `step` of a design. `guess` may pick a type from a part's image and name
 * (e.g. "postgres:16" → SQL DB) for parts that would otherwise be plain services.
 */
export function importInfra(d: Design, text: string, { step, guess }: { step?: string; guess?: (words: string) => ComponentType | undefined } = {}) {
  const { parts, links, groups } = readInfra(text);
  if (!parts.length) throw new Error('No services or workloads found.');
  const at = { step, reopen: false };
  const boundaryIds = new Map(groups.map((g) => [g.key, m.addBoundary(d, { kind: g.kind, label: g.label, id: g.key, ...at })]));
  const ids = new Map<string, string>();
  for (const p of parts) {
    // "registry.io/team/postgres:16@sha256:…" → "postgres:16"
    const tech = p.tech ?? p.image?.split('@')[0].split('/').pop();
    const type = (p.type === 'service' && guess?.(`${tech?.split(':')[0] ?? ''} ${p.label}`)) || p.type;
    ids.set(p.key, m.addComponent(d, { id: p.label, type, label: p.label, tech, code: p.code, boundary: p.group && boundaryIds.get(p.group), ...at }));
  }
  const seen = new Set<string>();
  for (const l of links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    m.connect(d, { from, to, label: l.label, ...at });
  }
  return { components: parts.length, connections: seen.size, boundaries: groups.length };
}
