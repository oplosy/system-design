import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { createDesign, listDesigns, listTemplates, readDesign, updateDesign } from '../core/store.ts';

const instructions = `Local system design canvas. The user reviews every step you add, one by one, so use it to make your architecture decisions visible.
- Work in steps: each add_step is one reviewable change ("Add cache in front of DB"). Put every component, connection, note and decision of that change into the same add_step call.
- Always record a decision (title, why, alternatives, tradeoffs) for any non-obvious choice, linked to the components it affects.
- Use notes for short explanations attached to a component.
- Ids are lowercase-dashed. Positions are optional: the app lays out new items automatically.
- Component types: ${COMPONENT_TYPES.join(', ')}.
- Group components with boundaries (${BOUNDARY_KINDS.join(', ')}): a box drawn around its members, nestable through parent (region > vpc > subnet, site > vlan). Give each component its innermost boundary; the box sizes itself.
- Start from list_designs; call get_design before editing an existing one.
- The reviewer can send steps back with comments. Before continuing a design, call get_feedback; fix what it asks (in that step, or in a new step), then resolve_feedback with a short reply. Resolving hands the step back for review.`;

const server = new McpServer({ name: 'system-design', version: '0.1.0' }, { instructions });

const Type = z.enum(COMPONENT_TYPES);
const design = z.string().describe('Design id');
const step = z.string().optional().describe('Step id; defaults to the latest step');
const componentFields = {
  type: Type,
  label: z.string().min(1),
  tech: z.string().optional().describe('Concrete technology, e.g. "Redis", "PostgreSQL"'),
  description: z.string().optional(),
  boundary: z.string().optional().describe('Id of the innermost boundary this component sits in'),
};
const connectionFields = {
  from: z.string().describe('Component id'),
  to: z.string().describe('Component id'),
  label: z.string().optional().describe('What flows, e.g. "HTTPS", "tweet events"'),
  async: z.boolean().optional().describe('true for queues, events and other async flows'),
  route: z.enum(['curve', 'straight', 'elbow']).optional().describe('How the line is drawn; curve by default'),
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
    inputSchema: { id: z.string().describe('lowercase-dashed id, also the file name'), title: z.string().min(1), description: z.string().optional(), template: z.string().optional() },
  },
  async (input) => {
    const d = await createDesign(input);
    return ok({ id: d.id, steps: d.steps.map((s) => s.id) });
  },
);

server.registerTool(
  'add_step',
  {
    description: 'Add one reviewable step, with everything it introduces, in a single atomic write',
    inputSchema: {
      design,
      title: z.string().min(1),
      summary: z.string().optional().describe('What changes in this step and why'),
      boundaries: z.array(z.object({ id: z.string().describe('Id to reference from components and other boundaries in this call'), ...boundaryFields })).optional().describe('Parents before children'),
      components: z.array(z.object({ id: z.string().describe('Id to reference from connections in this call'), ...componentFields })).optional(),
      connections: z.array(z.object(connectionFields)).optional(),
      notes: z.array(z.object(noteFields)).optional(),
      decisions: z.array(z.object(decisionFields)).optional(),
    },
  },
  async (input) =>
    edit(input.design, (d) => {
      const stepId = m.addStep(d, { title: input.title, summary: input.summary });
      const ids: Record<string, string> = {};
      const ref = (id: string) => ids[id] ?? id;
      for (const { members: _, ...b } of input.boundaries ?? []) ids[b.id] = m.addBoundary(d, { ...b, parent: b.parent && ref(b.parent), step: stepId });
      for (const c of input.components ?? []) ids[c.id] = m.addComponent(d, { ...c, boundary: c.boundary && ref(c.boundary), step: stepId });
      for (const b of input.boundaries ?? []) for (const member of b.members ?? []) m.placeIn(d, ref(member), ids[b.id]);
      for (const c of input.connections ?? []) m.connect(d, { ...c, from: ref(c.from), to: ref(c.to), step: stepId });
      for (const n of input.notes ?? []) m.addNote(d, { text: n.text, attachTo: n.attach_to && ref(n.attach_to), step: stepId });
      for (const x of input.decisions ?? []) m.addDecision(d, { ...x, links: x.links?.map(ref), step: stepId });
      return { step: stepId, ids };
    }),
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
    inputSchema: { design, id: z.string(), boundary: z.string().nullable().describe('Boundary id, or null for none') },
  },
  async ({ design: designId, id, boundary }) =>
    edit(designId, (d) => {
      m.placeIn(d, id, boundary ?? undefined);
      const item = d.components.find((x) => x.id === id) ?? d.boundaries.find((x) => x.id === id)!;
      d.steps.find((s) => s.id === item.step)!.seen = false;
      return id;
    }),
);

server.registerTool('add_note', { description: 'Add an explanatory note, optionally attached to a component', inputSchema: { design, ...noteFields, step } }, async ({ design: id, attach_to, ...input }) =>
  edit(id, (d) => m.addNote(d, { ...input, attachTo: attach_to })),
);

server.registerTool('add_decision', { description: 'Record an architecture decision and why it was made', inputSchema: { design, ...decisionFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addDecision(d, input)),
);

server.registerTool(
  'update_component',
  {
    description: 'Change a component; its step is reopened for review',
    inputSchema: { design, id: z.string(), type: Type.optional(), label: z.string().min(1).optional(), tech: z.string().optional(), description: z.string().optional() },
  },
  async ({ design: designId, id, ...fields }) =>
    edit(designId, (d) => {
      const c = d.components.find((x) => x.id === id);
      if (!c) throw new Error(`unknown component "${id}"`);
      Object.assign(c, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      d.steps.find((s) => s.id === c.step)!.seen = false;
      return id;
    }),
);

server.registerTool('remove_item', { description: 'Remove a component, connection, note, decision or boundary (its contents move to its parent)', inputSchema: { design, id: z.string() } }, async ({ design: designId, id }) =>
  edit(designId, (d) => m.removeItem(d, id)),
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

await server.connect(new StdioServerTransport());
