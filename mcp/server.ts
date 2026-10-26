import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COMPONENT_TYPES, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { createDesign, listDesigns, listTemplates, readDesign, updateDesign } from '../core/store.ts';

const instructions = `Local system design canvas. The user reviews every step you add, one by one, so use it to make your architecture decisions visible.
- Work in steps: each add_step is one reviewable change ("Add cache in front of DB"). Put every component, connection, note and decision of that change into the same add_step call.
- Always record a decision (title, why, alternatives, tradeoffs) for any non-obvious choice, linked to the components it affects.
- Use notes for short explanations attached to a component.
- Ids are lowercase-dashed. Positions are optional: the app lays out new items automatically.
- Component types: ${COMPONENT_TYPES.join(', ')}.
- Start from list_designs; call get_design before editing an existing one.`;

const server = new McpServer({ name: 'system-design', version: '0.1.0' }, { instructions });

const Type = z.enum(COMPONENT_TYPES);
const design = z.string().describe('Design id');
const step = z.string().optional().describe('Step id; defaults to the latest step');
const componentFields = {
  type: Type,
  label: z.string().min(1),
  tech: z.string().optional().describe('Concrete technology, e.g. "Redis", "PostgreSQL"'),
  description: z.string().optional(),
};
const connectionFields = {
  from: z.string().describe('Component id'),
  to: z.string().describe('Component id'),
  label: z.string().optional().describe('What flows, e.g. "HTTPS", "tweet events"'),
  async: z.boolean().optional().describe('true for queues, events and other async flows'),
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
      for (const c of input.components ?? []) ids[c.id] = m.addComponent(d, { ...c, step: stepId });
      const ref = (id: string) => ids[id] ?? id;
      for (const c of input.connections ?? []) m.connect(d, { ...c, from: ref(c.from), to: ref(c.to), step: stepId });
      for (const n of input.notes ?? []) m.addNote(d, { text: n.text, attachTo: n.attach_to && ref(n.attach_to), step: stepId });
      for (const x of input.decisions ?? []) m.addDecision(d, { ...x, links: x.links?.map(ref), step: stepId });
      return { step: stepId, components: ids };
    }),
);

server.registerTool('add_component', { description: 'Add a component to a step', inputSchema: { design, ...componentFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.addComponent(d, input)),
);

server.registerTool('connect', { description: 'Connect two components', inputSchema: { design, ...connectionFields, step } }, async ({ design: id, ...input }) =>
  edit(id, (d) => m.connect(d, input)),
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

server.registerTool('remove_item', { description: 'Remove a component, connection, note or decision', inputSchema: { design, id: z.string() } }, async ({ design: designId, id }) =>
  edit(designId, (d) => m.removeItem(d, id)),
);

await server.connect(new StdioServerTransport());
