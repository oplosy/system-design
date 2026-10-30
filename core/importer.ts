import type { ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';
import { fromPlugin, importDiagram, type PluginDiagram } from './diagram.ts';
import { expandDrawio, isDrawio, readDrawio } from './drawio.ts';
import { importMermaid, mermaidKind } from './mermaid.ts';
import { importInfra, readInfra } from './infra.ts';
import { isStructurizr, readStructurizr } from './structurizr.ts';

// One way in for anything pasted, dropped or handed over: Mermaid (flowchart, sequence, C4, architecture),
// C4-PlantUML, draw.io, Structurizr DSL, docker-compose, Kubernetes, Terraform JSON, CloudFormation, Pulumi,
// Backstage, OpenAPI, AsyncAPI or traces.

const NAMES = {
  flowchart: 'Mermaid flowchart',
  sequence: 'Mermaid sequence diagram',
  c4: 'C4 diagram',
  architecture: 'Mermaid architecture diagram',
  drawio: 'draw.io diagram',
  structurizr: 'Structurizr workspace',
  compose: 'docker-compose file',
  kubernetes: 'Kubernetes manifests',
  terraform: 'Terraform JSON',
  cloudformation: 'CloudFormation template',
  pulumi: 'Pulumi stack export',
  backstage: 'Backstage catalog',
  openapi: 'OpenAPI document',
  asyncapi: 'AsyncAPI document',
  otel: 'traces',
} as const;

type Guess = (words: string) => ComponentType | undefined;
/** What a plugin importer read from the text; plugins run on the server, so it arrives ready. */
type Plugged = { format: string; diagram: PluginDiagram } | null;

/** Undoes encodings some sources add (draw.io's clipboard and compressed pages); call before the rest. */
export async function unpack(text: string) {
  return isDrawio(text) ? expandDrawio(text) : text;
}

/** What `text` is, by name, or undefined when it is nothing an import reads. */
export function formatOf(text: string): string | undefined {
  const kind = mermaidKind(text);
  if (kind) return NAMES[kind];
  if (isDrawio(text)) return NAMES.drawio;
  if (isStructurizr(text)) return NAMES.structurizr;
  try {
    return NAMES[readInfra(text).format as keyof typeof NAMES];
  } catch {
    return undefined;
  }
}

/** Adds `text` to `step` of a design (the latest when unset), reusing the parts it already has. Returns what was added. */
export function importText(d: Design, text: string, { step, guess, plugin }: { step?: string; guess?: Guess; plugin?: Plugged } = {}) {
  if (plugin) return importDiagram(d, fromPlugin(plugin.diagram), { step, guess });
  if (mermaidKind(text)) return importMermaid(d, text, { step, guess });
  if (isDrawio(text)) return importDiagram(d, readDrawio(text), { step, guess });
  if (isStructurizr(text)) return importDiagram(d, readStructurizr(text), { step, guess });
  const { skipped } = readInfra(text);
  return { ...importInfra(d, text, { step, guess, reuse: true }), leftOut: skipped.length ? [`${skipped.join(', ')} (draw nothing)`] : [] };
}

const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n > 1 ? many : one}` : '');

/** Adds `text` to `d` as one new step, reusing the parts it already has. Returns the step id. */
export function importAsStep(d: Design, text: string, { title, seen, guess, plugin }: { title?: string; seen?: boolean; guess?: Guess; plugin?: Plugged } = {}) {
  const format = plugin?.format ?? formatOf(text);
  if (!format) {
    throw new Error(
      'Paste a Mermaid flowchart, sequence, C4 or architecture diagram, C4-PlantUML, a draw.io diagram, a Structurizr workspace, a docker-compose file, Kubernetes manifests, "terraform show -json" output, a CloudFormation or CDK template, a Pulumi stack export, a Backstage catalog, an OpenAPI or AsyncAPI document, or OTLP / Jaeger traces.',
    );
  }
  const step = m.addStep(d, { title: title ?? `Import ${format}`, seen });
  const added = importText(d, text, { step, guess, plugin });
  const what = [
    count(added.components.length, 'part'),
    count(added.connections.length, 'line'),
    count(added.boundaries.length, 'boundary', 'boundaries'),
    count(added.flows.length, 'flow'),
    count('updated' in added ? (added.updated as string[]).length : 0, 'measured line'),
    count('described' in added ? (added.described as string[]).length : 0, 'description'),
  ].filter(Boolean);
  if (!what.length) throw new Error(`Everything in this ${format} is already on the sheet.`);
  const left = added.leftOut.length ? ` Left out: ${added.leftOut.join('; ')}.` : '';
  d.steps.find((s) => s.id === step)!.summary = `From ${/s$/.test(format) ? '' : /^[AEIOU]/.test(format) ? 'an ' : 'a '}${format}: ${what.join(', ')}.${left}`;
  return step;
}
