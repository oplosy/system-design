import { getNodesBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { toDecisionRecord, toMermaid } from '../core/export.ts';
import { toDrawio, toPlantUml, toStructurizr } from '../core/interop.ts';
import type { Design } from '../core/schema.ts';
import { api, type PluginRead } from './api.ts';
import { download, downloadText, errorText } from './format.ts';
import type { ExportKind } from './menus.tsx';

export type ExportContext = {
  design: Design;
  /** The plugin that offers this format, when it is not a built-in one. */
  plugged: { key: string; extension?: string } | undefined;
  /** Saves a pending edit first: the server builds a file from what is on disk. */
  settle: () => Promise<void>;
  canvas: HTMLElement | null;
  /** The parts on the sheet, for the picture's bounds. */
  nodes: Node[];
  onError: (message: string) => void;
};

/** Downloads the design in a built-in or plugin format, or the sheet as a PNG or SVG picture. */
export async function exportDesign(kind: ExportKind, { design, plugged, settle, canvas, nodes, onError }: ExportContext) {
  if (kind === 'mermaid') return downloadText(toMermaid(design), `${design.id}.mmd`);
  if (kind === 'html' || plugged) {
    await settle();
    try {
      const res = await fetch(plugged ? `/api/v1/designs/${design.id}/export/${encodeURIComponent(plugged.key)}` : `/api/designs/${design.id}/share`);
      if (!res.ok) return onError(`Export failed: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
      const url = URL.createObjectURL(await res.blob());
      download(url, `${design.id}.${plugged?.extension ?? 'html'}`);
      return setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      return onError(`Export failed: ${errorText(e)}`);
    }
  }
  if (kind === 'decisions') return downloadText(toDecisionRecord(design), `${design.id}-decisions.md`);
  if (kind === 'structurizr') return downloadText(toStructurizr(design), `${design.id}.dsl`);
  if (kind === 'plantuml') return downloadText(toPlantUml(design), `${design.id}.puml`);
  if (kind === 'drawio') return downloadText(toDrawio(design), `${design.id}.drawio`);
  const el = canvas?.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el || !canvas || !nodes.length) return onError('Nothing on the sheet to export.');
  const b = getNodesBounds(nodes);
  // Room around the parts for arcs and labels that reach past them.
  const pad = 48, width = Math.ceil(b.width + 2 * pad), height = Math.ceil(b.height + 2 * pad);
  const options = {
    width,
    height,
    backgroundColor: getComputedStyle(canvas).getPropertyValue('--canvas').trim(),
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)` },
    // Leave out editing aids and review markers: the image is for docs, not for review.
    filter: (n: HTMLElement) => !['inline-edit', 'bend-handle', 'unseen-dot', 'comment-badge', 'lint-badge', 'node-open', 'node-code'].some((c) => n.classList?.contains(c)),
  };
  try {
    download(kind === 'png' ? await toPng(el, { ...options, pixelRatio: 2 }) : await toSvg(el, options), `${design.id}.${kind}`);
  } catch (e) {
    onError(`Export failed: ${errorText(e)}`);
  }
}

/** Reads a pasted or dropped diagram or infrastructure file. Returns what to import, or the message to show. */
export async function readSource(raw: string, what: string) {
  // Loaded only here, so the YAML parser stays out of the main bundle.
  const { formatOf, importAsStep, unpack } = await import('../core/importer.ts');
  let text: string;
  try {
    text = await unpack(raw);
  } catch (e) {
    return `That ${what} can’t be read: ${errorText(e)}`;
  }
  let plugin: PluginRead = null;
  try {
    plugin = await api.readWithPlugin(text);
  } catch (e) {
    return `That ${what} can’t be read: ${errorText(e)}`;
  }
  if (!plugin && !formatOf(text)) return `That ${what} isn’t a diagram or infrastructure file this can read.`;
  return { text, plugin, importAsStep };
}
