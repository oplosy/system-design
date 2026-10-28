import { z } from 'zod';

// Order is the palette order within each group.
export const COMPONENT_TYPES = [
  'user',
  'client',
  'mobile',
  'iot',
  'desktop-app',
  'console',
  'admin',
  'dns',
  'cdn',
  'waf',
  'firewall',
  'identity',
  'secrets',
  'rate-limiter',
  'ids',
  'ddos',
  'certificate',
  'load-balancer',
  'api-gateway',
  'reverse-proxy',
  'service-mesh',
  'realtime',
  'vpn',
  'nat-gateway',
  'forward-proxy',
  'service-discovery',
  'webrtc',
  'service',
  'worker',
  'function',
  'container',
  'kubernetes',
  'vm',
  'cron',
  'workflow',
  'bff',
  'game-server',
  'gpu',
  'media',
  'mainframe',
  'sql-db',
  'nosql-db',
  'key-value',
  'cache',
  'graph-db',
  'time-series',
  'vector-db',
  'search',
  'object-storage',
  'file-storage',
  'warehouse',
  'data-lake',
  'olap',
  'block-storage',
  'local-db',
  'backup',
  'ledger',
  'queue',
  'pubsub',
  'stream',
  'event-bus',
  'notification',
  'email',
  'webhook',
  'cdc',
  'mqtt',
  'monitoring',
  'logging',
  'tracing',
  'alerting',
  'ci-cd',
  'registry',
  'feature-flags',
  'iac',
  'git',
  'config',
  'stream-processor',
  'batch',
  'etl',
  'ml-model',
  'llm',
  'agent',
  'bi',
  'product-analytics',
  'feature-store',
  'recommender',
  'notebook',
  'training',
  'external',
  'payment',
  'sms',
  'maps',
  'crm',
  'cloud-provider',
  // Network diagrams
  'router',
  'switch',
  'l3-switch',
  'hub',
  'access-point',
  'wireless-controller',
  'modem',
  'patch-panel',
  'sd-wan',
  'media-converter',
  'kvm',
  'pbx',
  'ntp',
  'ipam',
  'pc',
  'laptop',
  'printer',
  'ip-phone',
  'camera',
  'server',
  'tablet',
  'pos',
  'badge-reader',
  'nvr',
  'rack',
  'nas',
  'ups',
  'pdu',
  'generator',
  'cooling',
  'tape',
  'internet',
  'cell-tower',
  'satellite',
  'mpls',
  'microwave',
  // Software diagrams
  'use-case',
  'class',
  'interface',
  'module',
  'package',
  'table',
  'layer',
  'ui',
  'controller',
  'app-service',
  'repository',
  'port',
  'adapter',
  'library',
  'aggregate',
  'entity',
  'value-object',
  'command',
  'query',
  'domain-event',
  'policy',
  'start',
  'end',
  'action',
  'choice',
  'fork',
  'state',
  'signal',
  'timer',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** Boxes that group components: cloud regions, networks, VLANs, sites, clusters, system boundaries, swimlanes. */
export const BOUNDARY_KINDS = ['region', 'zone', 'datacenter', 'vpc', 'subnet', 'vlan', 'cluster', 'site', 'system', 'context', 'lane', 'group'] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

/** Version of the design file format this app writes. */
export const SCHEMA_VERSION = 1;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');
const Position = z.object({ x: z.number(), y: z.number() });
/** The step option an item belongs to; it shows only while that option is viewed, until the reviewer picks one. */
const Option = Id.optional();

export const StepSchema = z.object({
  id: Id,
  title: z.string().min(1),
  summary: z.string().optional(),
  seen: z.boolean(),
  /** The reviewer sent this step back; cleared when the agent resolves the feedback. */
  changesRequested: z.boolean().optional(),
  /** Alternatives the agent proposes for this step ("Redis" vs "CDN"); the reviewer picks one. */
  options: z.array(z.object({ id: Id, title: z.string().min(1), summary: z.string().optional() })).min(2).optional(),
  /** What an agent removed in this step, kept so the diff can show it; components keep their shape and place. */
  removed: z.array(z.object({ id: Id, label: z.string(), type: z.enum(COMPONENT_TYPES).optional(), position: Position.optional() })).optional(),
  /** Fields an agent changed in this step on items from earlier steps, with the value before the step. */
  changed: z.array(z.object({ id: Id, field: z.string(), from: z.string().optional(), to: z.string().optional() })).optional(),
  /** Earlier items as they were before this step's agent edits touched them, so reverting the step can put them back. */
  before: z.array(z.object({ kind: z.enum(['components', 'connections', 'notes', 'decisions', 'boundaries', 'flows']), item: z.record(z.string(), z.unknown()) })).optional(),
});

export const ComponentSchema = z.object({
  id: Id,
  type: z.enum(COMPONENT_TYPES),
  label: z.string().min(1),
  tech: z.string().optional(),
  description: z.string().optional(),
  /** The innermost boundary this component sits in. */
  boundary: Id.optional(),
  /** Id of another design that shows what is inside this component (C4-style drill-down). */
  detail: Id.optional(),
  /** Where its code lives: a repository URL or a path in the repo. */
  code: z.string().optional(),
  /** Expected running cost per month, in the design's currency. */
  cost: z.number().nonnegative().optional(),
  /** Where an infrastructure import found it, as "<format>:<key>" (e.g. "terraform:aws_lb.public"); drift matches on it. */
  source: z.string().optional(),
  /** Requests per second it can take; lint compares it with the qps on lines into it. */
  capacity: z.number().nonnegative().optional(),
  position: Position.optional(),
  option: Option,
  step: Id,
});

export const BoundarySchema = z.object({
  id: Id,
  kind: z.enum(BOUNDARY_KINDS),
  label: z.string().min(1),
  /** Short qualifier shown next to the label: a CIDR, VLAN number or region code. */
  detail: z.string().optional(),
  description: z.string().optional(),
  /** The boundary this one sits in, e.g. a subnet's VPC. */
  parent: Id.optional(),
  /** Only used while the boundary is empty; otherwise it wraps its members. */
  position: Position.optional(),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
  option: Option,
  step: Id,
});

/** UML relationships a line can show; a plain arrow when omitted. */
export const CONNECTION_KINDS = ['inheritance', 'implementation', 'composition', 'aggregation', 'include', 'extend'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const ConnectionSchema = z.object({
  id: Id,
  from: Id,
  to: Id,
  label: z.string().optional(),
  async: z.boolean().optional(),
  /** Arrows point at `to` (the parent, interface or included case); diamonds sit at `from` (the whole). */
  kind: z.enum(CONNECTION_KINDS).optional(),
  /** How the line runs; curve when omitted. */
  route: z.enum(['curve', 'straight', 'elbow']).optional(),
  /** Expected load on this line, in requests per second. */
  qps: z.number().nonnegative().optional(),
  /** One-way time of a hop along this line, in milliseconds; a reply over the same line counts it again. */
  latency: z.number().nonnegative().optional(),
  /** Hand-set offset of the line's middle, in canvas pixels. */
  bend: z.number().optional(),
  option: Option,
  step: Id,
});

export const NoteSchema = z.object({
  id: Id,
  text: z.string().min(1),
  attachTo: Id.optional(),
  position: Position.optional(),
  option: Option,
  step: Id,
});

export const DecisionSchema = z.object({
  id: Id,
  title: z.string().min(1),
  why: z.string().min(1),
  alternatives: z.array(z.string()).optional(),
  tradeoffs: z.string().optional(),
  links: z.array(Id),
  position: Position.optional(),
  option: Option,
  step: Id,
});

/** A request path walked hop by hop ("User logs in"): component ids in order, each hop along a connection either way. */
export const FlowSchema = z.object({
  id: Id,
  title: z.string().min(1),
  path: z.array(Id).min(2),
  option: Option,
  step: Id,
});

/** Review feedback on a step, or on one item in it. */
export const CommentSchema = z.object({
  id: Id,
  step: Id,
  target: Id.optional(),
  text: z.string().min(1),
  by: z.enum(['reviewer', 'agent']),
  at: z.string(),
  resolved: z.boolean().optional(),
});

export const DesignSchema = z
  .object({
    id: Id,
    /** File format version; parseDesign migrates older files up to SCHEMA_VERSION. */
    version: z.literal(SCHEMA_VERSION),
    title: z.string().min(1),
    description: z.string().optional(),
    template: z.string().optional(),
    /** Web address of the repository; a component's code path opens against it. */
    repo: z.string().regex(/^https?:\/\/\S+$/i, 'an http(s) address').optional(),
    /** ISO 4217 code that component costs are in; USD when unset. */
    currency: z.string().regex(/^[A-Z]{3}$/, 'a three-letter code such as EUR').optional(),
    rev: z.number().int().nonnegative(),
    steps: z.array(StepSchema).min(1),
    components: z.array(ComponentSchema),
    connections: z.array(ConnectionSchema),
    notes: z.array(NoteSchema),
    decisions: z.array(DecisionSchema),
    // Optional so designs written before boundaries existed still load.
    boundaries: z.array(BoundarySchema).default([]),
    comments: z.array(CommentSchema).default([]),
    flows: z.array(FlowSchema).default([]),
  })
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const stepIds = new Set(d.steps.map((s) => s.id));
    if (stepIds.size !== d.steps.length) issue('duplicate step id');

    // Components, notes and decisions share one id space: they are all canvas nodes.
    const itemIds = new Set<string>();
    for (const item of [...d.components, ...d.notes, ...d.decisions, ...d.connections, ...d.boundaries, ...d.flows]) {
      if (itemIds.has(item.id)) issue(`duplicate id "${item.id}"`);
      itemIds.add(item.id);
      if (!stepIds.has(item.step)) issue(`"${item.id}" references unknown step "${item.step}"`);
    }
    const commentIds = new Set<string>();
    for (const c of d.comments) {
      if (commentIds.has(c.id) || itemIds.has(c.id)) issue(`duplicate id "${c.id}"`);
      commentIds.add(c.id);
      if (!stepIds.has(c.step)) issue(`comment "${c.id}" references unknown step "${c.step}"`);
      if (c.target && !itemIds.has(c.target)) issue(`comment "${c.id}" is about unknown "${c.target}"`);
    }
    const componentIds = new Set(d.components.map((c) => c.id));
    // Options: an item's option must be one of its step's, and nothing may lean on another option's item.
    const optionOf = new Map([...d.components, ...d.boundaries].map((x) => [x.id, x.option]));
    for (const x of [...d.components, ...d.notes, ...d.decisions, ...d.connections, ...d.boundaries, ...d.flows]) {
      if (x.option && !d.steps.find((s) => s.id === x.step)?.options?.some((o) => o.id === x.option)) issue(`"${x.id}" belongs to unknown option "${x.option}"`);
    }
    const lean = (x: { id: string; option?: string }, on: (string | undefined)[]) => {
      for (const id of on) if (id && optionOf.get(id) && optionOf.get(id) !== x.option) issue(`"${x.id}" uses "${id}" from another option`);
    };
    for (const c of d.components) lean(c, [c.boundary]);
    for (const b of d.boundaries) lean(b, [b.parent]);
    for (const c of d.connections) lean(c, [c.from, c.to]);
    for (const n of d.notes) lean(n, [n.attachTo]);
    for (const x of d.decisions) lean(x, x.links);
    for (const f of d.flows) lean(f, f.path);
    for (const c of d.components) if (c.detail === d.id) issue(`component "${c.id}" opens its own design`);
    for (const c of d.connections) {
      if (!componentIds.has(c.from)) issue(`connection "${c.id}" has unknown from "${c.from}"`);
      if (!componentIds.has(c.to)) issue(`connection "${c.id}" has unknown to "${c.to}"`);
    }
    for (const n of d.notes) {
      if (n.attachTo && !componentIds.has(n.attachTo)) issue(`note "${n.id}" attaches to unknown "${n.attachTo}"`);
    }
    for (const dec of d.decisions) {
      for (const l of dec.links) if (!componentIds.has(l)) issue(`decision "${dec.id}" links unknown "${l}"`);
    }
    // Hops may lose their connection when the reviewer edits; the canvas skips those, so only the stops are checked.
    for (const f of d.flows) {
      for (const p of f.path) if (!componentIds.has(p)) issue(`flow "${f.id}" passes unknown "${p}"`);
    }
    const parents = new Map(d.boundaries.map((b) => [b.id, b.parent]));
    for (const c of d.components) {
      if (c.boundary && !parents.has(c.boundary)) issue(`component "${c.id}" sits in unknown boundary "${c.boundary}"`);
    }
    for (const b of d.boundaries) {
      if (b.parent && !parents.has(b.parent)) issue(`boundary "${b.id}" sits in unknown boundary "${b.parent}"`);
      // Walk up the parents; coming back to b means a cycle.
      for (let p = b.parent, hops = 0; p && hops <= d.boundaries.length; p = parents.get(p), hops++) {
        if (p === b.id) {
          issue(`boundary "${b.id}" is inside itself`);
          break;
        }
      }
    }
  });

export type Step = z.infer<typeof StepSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Boundary = z.infer<typeof BoundarySchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Design = z.infer<typeof DesignSchema>;

export const isId = (s: string) => Id.safeParse(s).success;

export class ValidationError extends Error {}

/** MIGRATIONS[n] upgrades a version n + 1 design to n + 2 in place. Bump SCHEMA_VERSION when adding one. */
const MIGRATIONS: ((d: Record<string, unknown>) => void)[] = [];

/** Brings a design written by an older version up to SCHEMA_VERSION; files from before versioning count as 1. */
function migrate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const d = { ...(value as Record<string, unknown>) };
  const from = d.version ?? 1;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) throw new ValidationError(`version: must be a whole number from 1 up`);
  if (from > SCHEMA_VERSION) throw new ValidationError(`version ${from} is newer than this app understands (${SCHEMA_VERSION}); update the app`);
  for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v - 1](d);
  d.version = SCHEMA_VERSION;
  return d;
}

/** Parses a design, migrating older files and turning schema errors into one readable message. */
export function parseDesign(value: unknown): Design {
  const r = DesignSchema.safeParse(migrate(value));
  if (!r.success) throw new ValidationError(z.prettifyError(r.error));
  return r.data;
}
