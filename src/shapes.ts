import type { Options, PathInfo } from 'roughjs/bin/core';
import type { Drawable } from 'roughjs/bin/core';
import type { ComponentType } from '../core/schema.ts';
import { GROUPS, GROUP_COLOR, type Kit, type Spec, gen } from './shapes/base.ts';
import { added } from './shapes/added.ts';
import { network } from './shapes/network.ts';
import { networkMore } from './shapes/network-more.ts';
import { software } from './shapes/software.ts';
import { system } from './shapes/system.ts';
import { systemMore } from './shapes/system-more.ts';

export { GROUPS, GROUP_COLOR, KITS, NOTE_COLOR, type Kit } from './shapes/base.ts';

/** Every part. Earlier parts win a shared word in guessType, so the order here is the order of those tables. */
export const SHAPES: Record<ComponentType, Spec> = { ...system, ...network, ...systemMore, ...networkMore, ...software, ...added };

/** Kits whose palette lists `t`. */
export const kitsOf = (t: ComponentType): Kit[] => SHAPES[t].kits ?? [GROUPS.find((g) => g.key === SHAPES[t].group)!.kit];

/** Lowercase text the palette search matches against. */
export const searchText = (t: ComponentType) => `${SHAPES[t].name} ${t} ${SHAPES[t].keywords}`.toLowerCase();

/**
 * How well a search fits a part: 0 when its name starts with the first word, 1 when its name or id holds every word,
 * 2 when only its keywords do. Undefined when a word is nowhere in it.
 */
export function searchRank(t: ComponentType, terms: string[]): number | undefined {
  if (!terms.length || !terms.every((w) => searchText(t).includes(w))) return undefined;
  if (SHAPES[t].name.toLowerCase().startsWith(terms[0])) return 0;
  const head = `${SHAPES[t].name} ${t}`.toLowerCase();
  return terms.every((w) => head.includes(w)) ? 1 : 2;
}

export const NOTE_SIZE = { w: 190, h: 96 };
export const DECISION_SIZE = { w: 230, h: 120 };

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % 100000;
}

/** Shared drawing options. `currentColor` lets CSS pick the ink colour for light and dark mode. */
export function options(sketch: boolean, fill: string | undefined, seed: number, extra: Options = {}): Options {
  return sketch
    ? { stroke: 'currentColor', strokeWidth: 1.4, roughness: 1.2, fill, fillStyle: 'hachure', hachureGap: 11, fillWeight: 0.8, seed, ...extra }
    : { stroke: 'currentColor', strokeWidth: 1.2, roughness: 0, bowing: 0, disableMultiStroke: true, fill: fill && `${fill}30`, fillStyle: 'solid', seed, ...extra };
}

export const toPaths = (drawables: Drawable[]): PathInfo[] => drawables.flatMap((d) => gen.toPaths(d));

export function drawShape(type: ComponentType, sketch: boolean, seed: number) {
  const s = SHAPES[type];
  return toPaths(s.draw(options(sketch, GROUP_COLOR[s.group], seed), s.w, s.h));
}

export { gen };

// Words too common across parts to say anything about the type.
const GENERIC = new Set('api app apps server servers web data service services system the and for with main core new application node'.split(' '));
/**
 * Parts whose words only count when no other part has them, so a name like "Status page" or "Schema registry" never
 * takes "page" from UI or "registry" from the container registry. Every other tie goes to the part listed first above.
 */
const FALLBACK = new Set<ComponentType>([
  'policy-engine', 'transit-gateway', 'private-link', 'autoscaler', 'dead-letter-queue', 'schema-registry', 'status-page',
  'vulnerability-scanner', 'data-catalog', 'llm-gateway', 'mcp-server', 'object', 'enum', 'deployment-node', 'lifeline',
  'subprocess', 'document', 'data-store',
]);
const WORDS = Object.entries(SHAPES)
  .map(([type, s]) => [type, new Set(`${s.name} ${s.keywords}`.toLowerCase().split(/\s+/))] as const)
  .sort(([a], [b]) => Number(FALLBACK.has(a as ComponentType)) - Number(FALLBACK.has(b as ComponentType)));

// Products listed under several parts, and the one they are usually drawn as.
const PREFER: Record<string, ComponentType> = { redis: 'cache', database: 'sql-db', spring: 'service' };

/**
 * Picks a part type from free text such as "PostgreSQL Orders DB" or "Kafka consumer Mailer", trying the last word first:
 * the head of a name says what a thing is ("Kafka consumer" is a worker). Undefined when nothing specific matches.
 */
export function guessType(text: string): ComponentType | undefined {
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).reverse()) {
    if (word.length < 3 || GENERIC.has(word)) continue;
    if (PREFER[word]) return PREFER[word];
    const hit = WORDS.find(([, words]) => words.has(word));
    if (hit) return hit[0] as ComponentType;
  }
}
