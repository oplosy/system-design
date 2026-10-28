import type { ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';
import { importMermaid, mermaidKind } from './mermaid.ts';
import { importInfra, readInfra } from './infra.ts';

// One way in for anything pasted or handed over: Mermaid (flowchart, sequence, C4, architecture), C4-PlantUML,
// docker-compose, Kubernetes, Terraform JSON or traces, added to a design as one new step for review.

const NAMES = {
  flowchart: 'Mermaid flowchart',
  sequence: 'Mermaid sequence diagram',
  c4: 'C4 diagram',
  architecture: 'Mermaid architecture diagram',
  compose: 'docker-compose file',
  kubernetes: 'Kubernetes manifests',
  terraform: 'Terraform JSON',
  otel: 'traces',
} as const;

/** What `text` is, by name, or undefined when it is nothing an import reads. */
export function formatOf(text: string): string | undefined {
  const kind = mermaidKind(text);
  if (kind) return NAMES[kind];
  try {
    return NAMES[readInfra(text).format as keyof typeof NAMES];
  } catch {
    return undefined;
  }
}

const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n > 1 ? many : one}` : '');

/** Adds `text` to `d` as one new step, reusing the parts it already has. Returns the step id. */
export function importAsStep(
  d: Design,
  text: string,
  { title, seen, guess }: { title?: string; seen?: boolean; guess?: (words: string) => ComponentType | undefined } = {},
) {
  const format = formatOf(text);
  if (!format) {
    throw new Error('Paste a Mermaid flowchart, sequence, C4 or architecture diagram, C4-PlantUML, a docker-compose file, Kubernetes manifests, "terraform show -json" output or OTLP / Jaeger traces.');
  }
  const step = m.addStep(d, { title: title ?? `Import ${format}`, seen });
  const added = mermaidKind(text) ? importMermaid(d, text, { step, guess }) : importInfra(d, text, { step, guess });
  const what = [
    count(added.components.length, 'part'),
    count(added.connections.length, 'line'),
    count(added.boundaries.length, 'boundary', 'boundaries'),
    count(added.flows.length, 'flow'),
    count('updated' in added ? added.updated.length : 0, 'measured line'),
  ].filter(Boolean);
  if (!what.length) throw new Error(`Everything in this ${format} is already on the sheet.`);
  d.steps.find((s) => s.id === step)!.summary = `From ${/s$/.test(format) ? '' : 'a '}${format}: ${what.join(', ')}.`;
  return step;
}
