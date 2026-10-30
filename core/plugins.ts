import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { PluginDiagram } from './diagram.ts';
import type { Load } from './live.ts';
import { userAppDir } from './paths.ts';
import { REF_KINDS, type Design, type Ref } from './schema.ts';

// Plugins teach the app new formats, metric sources and link targets without a change here. Each is a JavaScript
// module in one folder of the user's own; it runs with the user's rights, so nothing a design, a repository or the API
// holds can add one. Loaded once per process, by the app and the MCP server alike.

export const PLUGINS_DIR = process.env.SYSTEM_DESIGN_PLUGINS ?? path.join(userAppDir(), 'plugins');

const TIMEOUT = 10000;

/** Stops waiting for a plugin that hangs. It can't stop one that blocks the process, which is why plugins must be trusted. */
export async function within<T>(work: T | Promise<T>, ms = TIMEOUT): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} seconds`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

const Fn = z.custom<(arg: never) => unknown>((x) => typeof x === 'function', 'a function');
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');
const Plugin = z.object({
  name: Id,
  /** Text to design: `matches(text)` says it is this format, `read(text)` returns a PluginDiagram. */
  importers: z.array(z.object({ id: Id, name: z.string().min(1), matches: Fn, read: Fn })).default([]),
  /** Design to text: `render(design)` returns a string, offered as a file with `extension`. */
  exporters: z.array(z.object({ id: Id, name: z.string().min(1), extension: z.string().regex(/^[a-z0-9]+$/i), render: Fn })).default([]),
  /** Measured load: `read(design)` returns samples shaped like those from Prometheus. */
  metrics: z.array(z.object({ name: z.string().min(1), read: Fn })).default([]),
  /** Opens a reference: `url(value)` returns the http(s) address of a ref of `kind`, or nothing. */
  links: z.array(z.object({ kind: z.enum(REF_KINDS), url: Fn })).default([]),
});
type Plugin = z.infer<typeof Plugin>;

const Samples = z.array(z.object({ client: z.string(), server: z.string(), value: z.number() })).default([]);
const LoadShape = z.object({ qps: Samples, failed: Samples, latency: Samples });
const Text = z.string();
const WebUrl = z.string().regex(/^https?:\/\/\S+$/i, 'an http(s) address');

/** Every plugin in `dir`; one that can't load is reported and the others still work. */
export async function loadPlugins(dir = PLUGINS_DIR) {
  const plugins: Plugin[] = [];
  const failed: { file: string; error: string }[] = [];
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => /\.m?js$/.test(f)).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { plugins, failed };
    throw e;
  }
  for (const file of files) {
    try {
      const plugin = Plugin.parse((await import(/* @vite-ignore */ pathToFileURL(path.join(dir, file)).href)).default);
      if (plugins.some((p) => p.name === plugin.name)) throw new Error(`another plugin is named ${plugin.name}`);
      plugins.push(plugin);
    } catch (e) {
      const error = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e);
      console.error(`system-design: plugin ${file} was not loaded: ${error}`);
      failed.push({ file, error });
    }
  }
  return { plugins, failed };
}

let loaded: ReturnType<typeof loadPlugins> | undefined;
const installed = () => (loaded ??= loadPlugins());

/** Calls into a plugin and checks what comes back, so a fault names the plugin instead of breaking somewhere later. */
async function call<T>(plugin: Plugin, f: () => unknown, shape: z.ZodType<T>): Promise<T> {
  try {
    return shape.parse(await within(f()));
  } catch (e) {
    throw new Error(`Plugin ${plugin.name}: ${e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : e}`);
  }
}

/** What is installed, for the app and the API: no code, and failures with their reason. */
export async function pluginList() {
  const { plugins, failed } = await installed();
  return {
    dir: PLUGINS_DIR,
    plugins: plugins.map((p) => ({
      name: p.name,
      importers: p.importers.map((x) => x.name),
      exporters: p.exporters.map((x) => ({ key: `${p.name}.${x.id}`, name: x.name, extension: x.extension })),
      metrics: p.metrics.map((x) => x.name),
      links: p.links.map((x) => x.kind),
    })),
    failed,
  };
}

/** The first plugin importer that recognises `text`, read, or undefined. A failing check only skips that importer. */
export async function readWithPlugins(text: string) {
  for (const p of (await installed()).plugins) {
    for (const i of p.importers) {
      let match = false;
      try {
        match = !!(await within((i.matches as (t: string) => unknown)(text)));
      } catch (e) {
        console.error(`system-design: plugin ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
      if (match) return { format: i.name, diagram: await call(p, () => (i.read as (t: string) => unknown)(text), PluginDiagram) };
    }
  }
  return undefined;
}

/** A design as text by exporter key (plugin.exporter), or undefined when there is no such exporter. */
export async function exportWithPlugin(key: string, design: Design) {
  for (const p of (await installed()).plugins) {
    const x = p.exporters.find((e) => `${p.name}.${e.id}` === key);
    if (x) return { text: await call(p, () => (x.render as (d: Design) => unknown)(design), Text), extension: x.extension };
  }
  return undefined;
}

/** Ways to measure a design's lines, one per metrics plugin. */
export async function pluginMetrics(): Promise<{ name: string; read: (d: Design) => Promise<Load> }[]> {
  return (await installed()).plugins.flatMap((p) => p.metrics.map((x) => ({ name: x.name, read: (d: Design) => call(p, () => (x.read as (d: Design) => unknown)(d), LoadShape) })));
}

/** Addresses for the refs that link plugins can open, by `kind:value`. */
export async function pluginLinks(refs: Ref[]) {
  const out: Record<string, string> = {};
  const { plugins } = await installed();
  for (const r of refs) {
    for (const p of plugins) {
      for (const x of p.links.filter((l) => l.kind === r.kind)) {
        const url = await call(p, () => (x.url as (v: string) => unknown)(r.value), WebUrl.optional());
        if (url) out[`${r.kind}:${r.value}`] ??= url;
      }
    }
  }
  return out;
}
