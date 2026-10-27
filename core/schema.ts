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

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');
const Position = z.object({ x: z.number(), y: z.number() });

export const StepSchema = z.object({
  id: Id,
  title: z.string().min(1),
  summary: z.string().optional(),
  seen: z.boolean(),
  /** The reviewer sent this step back; cleared when the agent resolves the feedback. */
  changesRequested: z.boolean().optional(),
});

export const ComponentSchema = z.object({
  id: Id,
  type: z.enum(COMPONENT_TYPES),
  label: z.string().min(1),
  tech: z.string().optional(),
  description: z.string().optional(),
  /** The innermost boundary this component sits in. */
  boundary: Id.optional(),
  position: Position.optional(),
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
  /** Hand-set offset of the line's middle, in canvas pixels. */
  bend: z.number().optional(),
  step: Id,
});

export const NoteSchema = z.object({
  id: Id,
  text: z.string().min(1),
  attachTo: Id.optional(),
  position: Position.optional(),
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
  step: Id,
});

/** A request path walked hop by hop ("User logs in"): component ids in order, each hop along a connection either way. */
export const FlowSchema = z.object({
  id: Id,
  title: z.string().min(1),
  path: z.array(Id).min(2),
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
    title: z.string().min(1),
    description: z.string().optional(),
    template: z.string().optional(),
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

/** Parses a design, turning schema errors into one readable message. */
export function parseDesign(value: unknown): Design {
  const r = DesignSchema.safeParse(value);
  if (!r.success) throw new ValidationError(z.prettifyError(r.error));
  return r.data;
}
