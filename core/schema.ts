import { z } from 'zod';

export const COMPONENT_TYPES = [
  'client',
  'cdn',
  'dns',
  'waf',
  'load-balancer',
  'api-gateway',
  'service',
  'worker',
  'sql-db',
  'nosql-db',
  'cache',
  'queue',
  'object-storage',
  'search',
  'external',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');
const Position = z.object({ x: z.number(), y: z.number() });

export const StepSchema = z.object({
  id: Id,
  title: z.string().min(1),
  summary: z.string().optional(),
  seen: z.boolean(),
});

export const ComponentSchema = z.object({
  id: Id,
  type: z.enum(COMPONENT_TYPES),
  label: z.string().min(1),
  tech: z.string().optional(),
  description: z.string().optional(),
  position: Position.optional(),
  step: Id,
});

export const ConnectionSchema = z.object({
  id: Id,
  from: Id,
  to: Id,
  label: z.string().optional(),
  async: z.boolean().optional(),
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
  })
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const stepIds = new Set(d.steps.map((s) => s.id));
    if (stepIds.size !== d.steps.length) issue('duplicate step id');

    // Components, notes and decisions share one id space: they are all canvas nodes.
    const itemIds = new Set<string>();
    for (const item of [...d.components, ...d.notes, ...d.decisions, ...d.connections]) {
      if (itemIds.has(item.id)) issue(`duplicate id "${item.id}"`);
      itemIds.add(item.id);
      if (!stepIds.has(item.step)) issue(`"${item.id}" references unknown step "${item.step}"`);
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
  });

export type Step = z.infer<typeof StepSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Design = z.infer<typeof DesignSchema>;

export const isId = (s: string) => Id.safeParse(s).success;

export class ValidationError extends Error {}

/** Parses a design, turning schema errors into one readable message. */
export function parseDesign(value: unknown): Design {
  const r = DesignSchema.safeParse(value);
  if (!r.success) throw new ValidationError(z.prettifyError(r.error));
  return r.data;
}
