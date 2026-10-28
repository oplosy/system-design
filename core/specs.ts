import type { ComponentType } from './schema.ts';
import type { Doc, Group, Link, Part } from './infra.ts';

// Reads what teams already write about their services: a Backstage catalog, an OpenAPI or an AsyncAPI document.

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

export const isBackstage = (docs: Doc[]) => docs.some((d) => str(d.apiVersion)?.startsWith('backstage.io/'));

/** Backstage Resource spec.type → part type; any other type is kept as the part's tech for a guess. */
const RESOURCES: Record<string, ComponentType> = {
  database: 'sql-db',
  's3-bucket': 'object-storage',
  bucket: 'object-storage',
  storage: 'object-storage',
  queue: 'queue',
  topic: 'pubsub',
  'kafka-topic': 'stream',
  stream: 'stream',
  cache: 'cache',
};
const COMPONENTS: Record<string, ComponentType> = { service: 'service', website: 'client', library: 'library' };

/**
 * Reads catalog-info.yaml entities: Components and Resources become parts, Systems the boundaries around them (inside their Domains),
 * dependsOn becomes lines, and an API one component provides and another consumes becomes a line between them.
 */
export function backstage(docs: Doc[]) {
  const entities = docs.filter((d) => str(d.kind) && str(obj(d.metadata).name));
  // An entity ref is [kind:][namespace/]name; the kind defaults by field (an API for providesApis, a System for system).
  const ref = (r: unknown, kind: string, ns = 'default') => {
    const m = /^(?:([^:/]+):)?(?:([^/]+)\/)?(.+)$/.exec(String(r).trim().toLowerCase());
    return m ? `${m[1] ?? kind.toLowerCase()}:${m[2] ?? ns.toLowerCase()}/${m[3]}` : '';
  };
  const key = (d: Doc) => ref(obj(d.metadata).name, String(d.kind), str(obj(d.metadata).namespace));
  const title = (d: Doc) => String(obj(d.metadata).title ?? obj(d.metadata).name);
  const ns = (d: Doc) => str(obj(d.metadata).namespace);
  // A System's or Domain's name is its boundary's id; parts and systems find it by ref.
  const systems = new Map(entities.filter((d) => d.kind === 'System').map((d) => [key(d), String(obj(d.metadata).name)]));
  const named = new Set(systems.values());
  const domains = new Map(entities.filter((d) => d.kind === 'Domain').map((d) => [key(d), named.has(obj(d.metadata).name) ? `${obj(d.metadata).name}-domain` : String(obj(d.metadata).name)]));
  const parentOf = (d: Doc) => {
    const p = obj(d.spec)[d.kind === 'System' ? 'domain' : 'subdomainOf'];
    return p ? domains.get(ref(p, 'domain', ns(d))) : undefined;
  };
  // Parents first: a domain's depth is how many domains it sits in (a cycle stops at the domain count).
  const depth = (d: Doc, n = 0): number => {
    const p = parentOf(d) && entities.find((e) => e.kind === 'Domain' && domains.get(key(e)) === parentOf(d));
    return p && n < domains.size ? depth(p, n + 1) : n;
  };
  const groups: Group[] = [
    ...entities
      .filter((d) => d.kind === 'Domain')
      .sort((a, b) => depth(a) - depth(b))
      .map((d): Group => ({ key: domains.get(key(d))!, label: title(d), kind: 'context', parent: parentOf(d) })),
    ...entities.filter((d) => d.kind === 'System').map((d): Group => ({ key: systems.get(key(d))!, label: title(d), kind: 'system', parent: parentOf(d) })),
  ];
  const parts: Part[] = [];
  const skipped: string[] = [];
  for (const d of entities) {
    const spec = obj(d.spec);
    const type = str(spec.type)?.toLowerCase() ?? '';
    const mapped = d.kind === 'Component' ? COMPONENTS[type] : d.kind === 'Resource' ? RESOURCES[type] : undefined;
    if (d.kind !== 'Component' && d.kind !== 'Resource') {
      if (!['System', 'Domain', 'API'].includes(d.kind)) skipped.push(`${d.kind} ${obj(d.metadata).name}`);
      continue;
    }
    const system = spec.system && ref(spec.system, 'system', str(obj(d.metadata).namespace));
    const source = str(obj(obj(d.metadata).annotations)['backstage.io/source-location'])?.replace(/^url:/, '');
    parts.push({
      key: key(d),
      label: title(d),
      type: mapped ?? 'service',
      // An unknown type ("redis", "grpc-service") still says what the part is; it becomes the tech and feeds the guess.
      image: mapped ? undefined : type || undefined,
      description: str(obj(d.metadata).description),
      group: system ? systems.get(system) : undefined,
      code: source,
    });
  }
  const links: Link[] = [];
  const providers = new Map<string, string[]>();
  for (const d of entities) for (const a of list(obj(d.spec).providesApis)) providers.set(ref(a, 'api', ns(d)), [...(providers.get(ref(a, 'api', ns(d))) ?? []), key(d)]);
  const apis = new Map(entities.filter((d) => d.kind === 'API').map((d) => [key(d), title(d)]));
  for (const d of entities) {
    const spec = obj(d.spec);
    for (const to of list(spec.dependsOn)) links.push({ from: key(d), to: ref(to, 'component', ns(d)) });
    for (const a of list(spec.consumesApis)) {
      const api = ref(a, 'api', ns(d));
      const from = providers.get(api) ?? [];
      if (!from.length) skipped.push(`API ${api.replace(/^api:default\//, '')} (no provider in the catalog)`);
      for (const to of from) links.push({ from: key(d), to, label: apis.get(api) ?? api.split('/').pop() });
    }
  }
  // Keep the boxes that hold a part, and the domains around them (children come after parents, so walk backwards).
  const used = new Set(parts.map((p) => p.group));
  for (const g of [...groups].reverse()) if (used.has(g.key) && g.parent) used.add(g.parent);
  return { parts, links, groups: groups.filter((g) => used.has(g.key)), skipped };
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Reads an OpenAPI (or Swagger 2) document: a service part whose description lists its endpoints, and what it calls out to. */
export function openapi(doc: Doc) {
  const info = obj(doc.info);
  const label = str(info.title) ?? 'API';
  const endpoints = Object.entries(obj(doc.paths)).flatMap(([path, ops]) => Object.keys(obj(ops)).filter((k) => METHODS.includes(k)).map((k) => `${k.toUpperCase()} ${path}`));
  const shown = endpoints.slice(0, 30).join(', ') + (endpoints.length > 30 ? ` and ${endpoints.length - 30} more` : '');
  const description = [str(info.description), shown && `Endpoints: ${shown}`].filter(Boolean).join('\n\n') || undefined;
  const parts: Part[] = [{ key: label, label, type: 'service', tech: str(info.version) ? `REST ${info.version}` : 'REST', description }];
  const links: Link[] = [];
  // What the service itself calls: the sign-in provider its OAuth / OpenID Connect schemes name, and webhook subscribers.
  const schemes = Object.values(obj(obj(doc.components).securitySchemes ?? doc.securityDefinitions)).map(obj);
  const urls = schemes.flatMap((s) => [s.openIdConnectUrl, s.authorizationUrl, s.tokenUrl, ...Object.values(obj(s.flows)).flatMap((f) => [obj(f).authorizationUrl, obj(f).tokenUrl])]);
  const idp = urls.map((u) => str(u) && /^https?:\/\/([^/:]+)/i.exec(String(u))?.[1]).find(Boolean);
  if (idp) {
    parts.push({ key: `idp:${idp}`, label: idp, type: 'identity', tech: schemes.some((s) => s.type === 'openIdConnect') ? 'OpenID Connect' : 'OAuth 2' });
    links.push({ from: label, to: `idp:${idp}`, label: 'verifies tokens' });
  }
  const hooks = Object.keys(obj(doc.webhooks));
  if (hooks.length) {
    parts.push({ key: 'webhooks', label: `${label} webhooks`, type: 'webhook', description: `Events: ${hooks.join(', ')}` });
    links.push({ from: label, to: 'webhooks', async: true });
  }
  return { parts, links, groups: [] as Group[], skipped: [] as string[] };
}

/** Message protocol (AsyncAPI server protocol) → the kind of part its channels draw as. */
const PROTOCOLS: Record<string, ComponentType> = { kafka: 'stream', 'kafka-secure': 'stream', kinesis: 'stream', amqp: 'queue', amqps: 'queue', sqs: 'queue', jms: 'queue', ibmmq: 'queue', mqtt: 'mqtt', mqtt5: 'mqtt', 'secure-mqtt': 'mqtt' };

/**
 * Reads an AsyncAPI document (2.x or 3.x): the application is a part, each channel a queue, topic or stream part,
 * and what it sends or receives an async line to or from that channel.
 */
export function asyncapi(doc: Doc) {
  const info = obj(doc.info);
  const app = str(info.title) ?? 'Application';
  const protocol = Object.values(obj(doc.servers)).map((s) => str(obj(s).protocol)?.toLowerCase()).find(Boolean);
  const type = (protocol && PROTOCOLS[protocol]) || 'pubsub';
  const parts: Part[] = [{ key: app, label: app, type: 'service', description: str(info.description) }];
  const links: Link[] = [];
  const channel = (name: string, c: Doc) => {
    const key = `channel:${name}`;
    if (!parts.some((p) => p.key === key)) parts.push({ key, label: str(c.address) ?? name, type, tech: protocol, description: str(c.description) });
    return key;
  };
  const v3 = String(doc.asyncapi).startsWith('3');
  const channels = obj(doc.channels);
  if (v3) {
    for (const op of Object.values(obj(doc.operations)).map(obj)) {
      // Operations point at their channel with a $ref: "#/channels/userSignedUp".
      const name = decodeURIComponent(String(obj(op.channel).$ref ?? '').replace(/^#\/channels\//, '').replace(/~1/g, '/').replace(/~0/g, '~'));
      if (!(name in channels)) continue;
      const c = channel(name, obj(channels[name]));
      links.push(op.action === 'send' ? { from: app, to: c, async: true } : { from: c, to: app, async: true });
    }
  } else {
    // 2.x names operations from the other side: subscribe means the application sends, publish that it receives.
    for (const [name, c] of Object.entries(channels).map(([n, c]) => [n, obj(c)] as const)) {
      if (c.subscribe) links.push({ from: app, to: channel(name, c), async: true });
      if (c.publish) links.push({ from: channel(name, c), to: app, async: true });
    }
  }
  return { parts, links, groups: [] as Group[], skipped: [] as string[] };
}
