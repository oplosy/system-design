import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type Design } from '../core/schema.ts';
import { infraDrift, syncInfra } from '../core/infra.ts';
import { lint } from '../core/lint.ts';
import * as m from '../core/mutations.ts';
import { createDesign, listDesigns, listTemplates, readDesign, updateDesign } from '../core/store.ts';
import { guessType } from '../src/shapes.ts';

const instructions = `Local system design canvas. The user reviews every step you add, one by one, so use it to make your architecture decisions visible.
- Work in steps: each add_step is one reviewable change ("Add cache in front of DB"). Put every component, connection, note and decision of that change into the same add_step call.
- Always record a decision (title, why, alternatives, tradeoffs) for any non-obvious choice, linked to the components it affects.
- Use notes for short explanations attached to a component.
- Ids are lowercase-dashed. Positions are optional: the app lays out new items automatically.
- Component types: ${COMPONENT_TYPES.join(', ')}.
- Group components with boundaries (${BOUNDARY_KINDS.join(', ')}): a box drawn around its members, nestable through parent (region > vpc > subnet, site > vlan). Give each component its innermost boundary; the box sizes itself.
- Show the key request paths as flows ("User uploads a photo"): component ids in order, each hop along a connection (either way, so responses can walk back).
- Keep a big design readable with drill-down: create a design for a service's insides and set the service's detail to its id.
- When there is a real choice to make (Redis vs CDN), offer it as options in add_step; the reviewer compares them on the canvas and picks one.
- Put expected load (qps) and one-way latency (ms) on the lines that matter; a flow then shows its total time.
- Put a monthly cost on parts that cost real money (in the design's currency, USD unless set); each step then shows how much it moves the total.
- Set code on parts whose code you know: a URL, or a path that opens against the design's repo.
- When the project has docker-compose files, Kubernetes manifests or Terraform, run sync_infra with dry_run to see what the design is missing, and sync it as a step when the infrastructure is the truth.
- After a step, run lint and fix what it finds or say in a note why it is fine.
- Start from list_designs; call get_design before editing an existing one.
- The reviewer can send steps back with comments. Before continuing a design, call get_feedback; fix what it asks (in that step, or in a new step), then resolve_feedback with a short reply. Resolving hands the step back for review.`;

const server = new McpServer({ name: 'system-design', version: '0.1.0' }, { instructions });

const Type = z.enum(COMPONENT_TYPES);
const design = z.string().describe('Design id');
const step = z.string().optional().describe('Step id; defaults to the latest step');
const designFields = {
  repo: z.string().optional().describe('Web address of the repository, e.g. "https://github.com/acme/shop/tree/main"; component code paths open against it'),
  currency: z.string().optional().describe('ISO 4217 code that component costs are in, e.g. "EUR"; USD when unset'),
};
const componentFields = {
  type: Type,
  label: z.string().min(1),
  tech: z.string().optional().describe('Concrete technology, e.g. "Redis", "PostgreSQL"'),
  description: z.string().optional(),
  boundary: z.string().optional().describe('Id of the innermost boundary this component sits in'),
  detail: z.string().optional().describe('Id of another design that shows what is inside this component; create it first with create_design'),
  code: z.string().optional().describe('Where its code lives: a repository URL, or a path in the repo such as "services/orders"'),
  cost: z.number().nonnegative().optional().describe("Expected running cost per month in the design's currency (USD unless set)"),
};
const connectionFields = {
  from: z.string().describe('Component id'),
  to: z.string().describe('Component id'),
  label: z.string().optional().describe('What flows, e.g. "HTTPS", "tweet events"'),
  async: z.boolean().optional().describe('true for queues, events and other async flows'),
  route: z.enum(['curve', 'straight', 'elbow']).optional().describe('How the line is drawn; curve by default'),
  qps: z.number().nonnegative().optional().describe('Expected requests per second on this line'),
  latency: z.number().nonnegative().optional().describe('One-way time of a hop along this line in ms; flows add these up, a reply hop counts it again'),
  kind: z
    .enum(CONNECTION_KINDS)
    .optional()
    .describe('UML relationship; omit for a plain arrow. inheritance/implementation/include/extend point from -> to (child -> parent, class -> interface); composition/aggregation put the diamond on from (the whole)'),
};
const boundaryFields = {
  kind: z.enum(BOUNDARY_KINDS),
  label: z.string().min(1).describe('e.g. "us-east-1", "Office LAN"'),
  detail: z.string().optional().describe('Short qualifier: CIDR, VLAN number, region code'),
  description: z.string().optional(),
  parent: z.string().optional().describe('Id of the boundary this one sits in'),
  members: z.array(z.string()).optional().describe('Ids of components that sit directly in this boundary'),
};
const noteFields = { text: z.string().min(1), attach_to: z.string().optional().describe('Component id') };
const decisionFields = {
  title: z.string().min(1),
  why: z.string().min(1),
  alternatives: z.array(z.string()).optional(),
  tradeoffs: z.string().optional(),
  links: z.array(z.string()).optional().describe('Ids of the components this decision affects'),
};

const flowFields = {
  title: z.string().min(1).describe('What happens, e.g. "User uploads a photo"'),
  path: z.array(z.string()).min(2).describe('Component ids in the order the request visits them; each hop must follow a connection'),
};

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

async function edit<T>(id: string, change: (d: Design) => T) {
  let result!: T;
  const d = await updateDesign(id, (x) => {
    result = change(x);
  });
  return ok({ result, rev: d.rev, unseenSteps: d.steps.filter((s) => !s.seen).length });
}

server.registerTool('list_designs', { description: 'List designs with their count of unreviewed steps' }, async () => ok(await listDesigns()));

server.registerTool('list_templates', { description: 'List templates a design can start from' }, async () => ok(await listTemplates()));

server.registerTool('get_design', { description: 'Read a full design', inputSchema: { id: design } }, async ({ id }) => ok(await readDesign(id)));

server.registerTool(
  'create_design',
  {
    description: 'Create a new design, empty or copied from a template',
    inputSchema: {
      id: z.string().describe('lowercase-dashed id, also the file name'),
      title: z.string().min(1),
      description: z.string().optional(),
      template: z.string().optional(),
      ...designFields,
    },
  },
  async (input) => {
    const d = await createDesign(input);
    return ok({ id: d.id, steps: d.steps.map((s) => s.id) });
  },
);

server.registerTool(
  'update_design',
  {
    description: "Change a design's title, description, repository or currency",
    inputSchema: { id: design, title: z.string().min(1).optional(), description: z.string().optional(), ...designFields },
  },
  async ({ id, ...fields }) =>
    edit(id, (d) => {
      Object.assign(d, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      return id;
    }),
);

const bundleFields = {
  boundaries: z.array(z.object({ id: z.string().describe('Id to reference from components and other boundaries in this call'), ...boundaryFields })).optional().describe('Parents before children'),
  components: z.array(z.object({ id: z.string().describe('Id to reference from connections in this call'), ...componentFields })).optional(),
  connections: z.array(z.object(connectionFields)).optional(),
  notes: z.array(z.object(noteFields)).optional(),
  decisions: z.array(z.object(decisionFields)).optional(),
  flows: z.array(z.object(flowFields)).optional(),
};
type Bundle = { [K in keyof typeof bundleFields]?: z.infer<(typeof bundleFields)[K]> };

/** Adds everything in a bundle to a step (and option); `ids` maps the call's ids to the stored ones. */
function addBundle(d: Design, input: Bundle, step: string, option: string | undefined, ids: Record<string, string>) {
  const ref = (id: string) => ids[id] ?? id;
  const at = { step, option };
  for (const { members: _, ...b } of input.boundaries ?? []) ids[b.id] = m.addBoundary(d, { ...b, parent: b.parent && ref(b.parent), ...at });
  for (const c of input.components ?? []) ids[c.id] = m.addComponent(d, { ...c, boundary: c.boundary && ref(c.boundary), ...at });
  for (const b of input.boundaries ?? []) for (const member of b.members ?? []) m.placeIn(d, ref(member), ids[b.id]);
  for (const c of input.connections ?? []) m.connect(d, { ...c, from: ref(c.from), to: ref(c.to), ...at });
  for (const n of input.notes ?? []) m.addNote(d, { text: n.text, attachTo: n.attach_to && ref(n.attach_to), ...at });
  for (const x of input.decisions ?? []) m.addDecision(d, { ...x, links: x.links?.map(ref), ...at });
  for (const f of input.flows ?? []) m.addFlow(d, { ...f, path: f.path.map(ref), ...at });
}

server.registerTool(
  'add_step',
  {
    description: 'Add one reviewable step, with everything it introduces, in a single atomic write. To let the reviewer choose between alternatives, put each in options',
    inputSchema: {
      design,
      title: z.string().min(1),
      summary: z.string().optional().describe('What changes in this step and why'),
      ...bundleFields,
      options: z
        .array(z.object({ id: z.string().optional(), title: z.string().min(1).describe('e.g. "Redis"'), summary: z.string().optional().describe('Why this option; becomes the decision when picked'), ...bundleFields }))
        .min(2)
        .optional()
        .describe('Alternatives the reviewer picks between. Items at the top level are shared by every option; each option may use them but not another option’s items'),
    },
  },
  async ({ design: id, title, summary, options, ...shared }) =>
    edit(id, (d) => {
      const stepId = m.addStep(d, { title, summary, options });
      const ids: Record<string, string> = {};
      addBundle(d, shared, stepId, undefined, ids);
      const stored = d.steps.find((s) => s.id === stepId)!.options ?? [];
      // Each option sees the shared ids plus its own, never another option's.
      const optionIds = (options ?? []).map((o, i) => {
        const own = { ...ids };
        addBundle(d, o, stepId, stored[i].id, own);
        return { option: stored[i].id, ids: own };
      });
      return { step: stepId, ids, options: optionIds };
    }),
);

server.registerTool(
  'pick_option',
  {
    description: 'Pick one option of a step for the reviewer when they told you which: the others are removed and a decision records the pick',
    inputSchema: { design, step: z.string(), option: z.string() },
  },
  async ({ design: id, step: stepId, option }) => edit(id, (d) => m.pickOption(d, stepId, option)),
);

server.registerTool('add_component', { description: 'Add a component to a step', inputSchema: { design, ...componentFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addComponent(d, input)),
);

server.registerTool('connect', { description: 'Connect two components', inputSchema: { design, ...connectionFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.connect(d, input)),
);

server.registerTool('add_boundary', { description: 'Draw a boundary (region, VPC, subnet, VLAN, site...) around components', inputSchema: { design, ...boundaryFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addBoundary(d, input)),
);

server.registerTool(
  'place_in',
  {
    description: 'Move a component or boundary into a boundary, or out of all boundaries with boundary: null',
    inputSchema: { design, id: z.string(), boundary: z.string().nullable().describe('Boundary id, or null for none'), step },
  },
  async ({ design: designId, id, boundary, step }) =>
    edit(designId, (d) => {
      m.updateTracked(d, id, { [d.boundaries.some((b) => b.id === id) ? 'parent' : 'boundary']: boundary ?? undefined }, step);
      return id;
    }),
);

server.registerTool('add_note', { description: 'Add an explanatory note, optionally attached to a component', inputSchema: { design, ...noteFields, step } }, async ({ design: id, attach_to, ...input }) =>
  edit(id, (d) => m.addNote(d, { ...input, attachTo: attach_to })),
);

server.registerTool('add_decision', { description: 'Record an architecture decision and why it was made', inputSchema: { design, ...decisionFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addDecision(d, input)),
);

server.registerTool('add_flow', { description: 'Add a request path that the reviewer can play hop by hop', inputSchema: { design, ...flowFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addFlow(d, input)),
);

server.registerTool('lint', { description: 'Check a design for likely smells: isolated parts, single points of failure, exposed datastores, unlinked decisions', inputSchema: { id: design } }, async ({ id }) =>
  ok(lint(await readDesign(id))),
);

server.registerTool(
  'update_connection',
  {
    description: 'Change a connection (label, mode, load, latency). The change is recorded on the step (latest by default) for review, with its old values',
    inputSchema: { design, id: z.string(), label: z.string().optional(), async: z.boolean().optional(), qps: connectionFields.qps, latency: connectionFields.latency, step },
  },
  async ({ design: designId, id, step, ...fields }) =>
    edit(designId, (d) => {
      if (!d.connections.some((x) => x.id === id)) throw new Error(`unknown connection "${id}"`);
      m.updateTracked(d, id, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), step);
      return id;
    }),
);

server.registerTool(
  'update_component',
  {
    description: 'Change a component. The change is recorded on the step (latest by default) for review, with its old values',
    inputSchema: { design, id: z.string(), type: Type.optional(), label: z.string().min(1).optional(), tech: z.string().optional(), description: z.string().optional(), detail: componentFields.detail, code: componentFields.code, cost: componentFields.cost, step },
  },
  async ({ design: designId, id, step, ...fields }) =>
    edit(designId, (d) => {
      if (!d.components.some((x) => x.id === id)) throw new Error(`unknown component "${id}"`);
      m.updateTracked(d, id, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), step);
      return id;
    }),
);

server.registerTool(
  'remove_item',
  {
    description: 'Remove a component, connection, note, decision, flow or boundary (its contents move to its parent). The removal is recorded on the step (latest by default) for review',
    inputSchema: { design, id: z.string(), step },
  },
  async ({ design: designId, id, step }) => edit(designId, (d) => m.removeTracked(d, id, step)),
);

server.registerTool(
  'get_feedback',
  { description: 'Steps the reviewer sent back, with their open comments (a comment may be about one item)', inputSchema: { id: design } },
  async ({ id }) => ok(m.feedback(await readDesign(id))),
);

server.registerTool(
  'resolve_feedback',
  {
    description: 'Mark feedback as handled, with an optional reply the reviewer will read. The affected steps go back to the review queue.',
    inputSchema: {
      design,
      comments: z.array(z.string()).optional().describe('Comment ids to resolve'),
      step: z.string().optional().describe('Resolve every open comment on this step, and its change request'),
      reply: z.string().optional().describe('What you changed, or why you kept it'),
    },
  },
  async ({ design: id, ...input }) => {
    if (!input.comments?.length && !input.step) throw new Error('Pass comments or step.');
    return edit(id, (d) => m.resolveFeedback(d, input));
  },
);

server.registerTool(
  'sync_infra',
  {
    description:
      'Compare a design with the infrastructure it describes (docker-compose, Kubernetes YAML, or `terraform show -json` output) and add what the design lacks (parts, lines, boundaries) as one new step for review. Parts match by id or label.',
    inputSchema: {
      design,
      path: z.string().describe('Absolute path of the infrastructure file'),
      title: z.string().optional().describe('Step title; defaults to "Sync with <file name>"'),
      dry_run: z.boolean().optional().describe('Only report what is missing, change nothing'),
    },
  },
  async ({ design: id, path: file, title, dry_run }) => {
    const text = await fs.readFile(path.resolve(file), 'utf8');
    if (dry_run) return ok(infraDrift(await readDesign(id), text, guessType));
    return edit(id, (d) => syncInfra(d, text, title ?? `Sync with ${path.basename(file)}`, guessType) ?? 'nothing missing; no step added');
  },
);

await server.connect(new StdioServerTransport());
