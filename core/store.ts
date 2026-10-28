import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankDesign } from './mutations.ts';
import { isId, parseDesign, type Design } from './schema.ts';

// import.meta.url (not dirname) survives Vite bundling this file into its config.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The per-user data folder, which survives updates and reinstalls of the app (unlike a folder next to its code). */
function userDataDir() {
  const home = os.homedir();
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'));
  return path.join(base, 'system-design', 'designs');
}

// One folder for the app, the MCP server and the CLI alike, so what an agent writes is what the reviewer sees.
export const DESIGNS_DIR = process.env.SYSTEM_DESIGN_DIR ?? userDataDir();
export const TEMPLATES_DIR = path.join(ROOT, 'templates');
export const TRASH_DIR = path.join(DESIGNS_DIR, '.trash');
/** Where designs lived before they moved to the user data folder. */
const LEGACY_DIR = path.join(ROOT, 'designs');

/**
 * Copies designs from the old folder next to the code into the data folder, once. Files already there win and
 * nothing is deleted; a marker records it so a design deleted later does not come back. Sync, so it is done
 * before the API's folder watcher or any read starts.
 */
export function adoptLegacy(from = LEGACY_DIR, to = DESIGNS_DIR) {
  const marker = path.join(to, '.adopted');
  if (existsSync(marker) || !existsSync(from) || path.resolve(from) === path.resolve(to)) return [];
  mkdirSync(to, { recursive: true });
  const copied = readdirSync(from)
    .filter((f) => f.endsWith('.json') && isId(f.slice(0, -5)) && !existsSync(path.join(to, f)))
    .map((f) => (copyFileSync(path.join(from, f), path.join(to, f)), f.slice(0, -5)));
  writeFileSync(marker, `Copied ${copied.length} designs from ${from} on ${new Date().toISOString()}. The originals are still there.\n`);
  return copied;
}
if (!process.env.SYSTEM_DESIGN_DIR) adoptLegacy();

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

// Ids become file names, so this check is what keeps paths inside the folder.
function fileFor(dir: string, id: string) {
  if (!isId(id)) throw new Error(`invalid id "${id}"`);
  return path.join(dir, `${id}.json`);
}

async function readFrom(dir: string, id: string): Promise<Design> {
  let raw: string;
  try {
    raw = await fs.readFile(fileFor(dir, id), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`"${id}" not found`);
    throw e;
  }
  return parseDesign(JSON.parse(raw));
}

async function listFrom(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const d = await readFrom(dir, f.slice(0, -5));
      const updated = (await fs.stat(path.join(dir, f))).mtimeMs;
      out.push({ id: d.id, title: d.title, description: d.description, steps: d.steps.length, unseen: d.steps.filter((s) => !s.seen).length, updated });
    } catch {
      // A broken file must not hide the others; readDesign reports its error when opened.
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export const listDesigns = () => listFrom(DESIGNS_DIR);
export const listTemplates = () => listFrom(TEMPLATES_DIR);
export const readDesign = (id: string) => readFrom(DESIGNS_DIR, id);

/** Writes `design` if `design.rev` still matches the file on disk, and returns it with rev + 1. */
export async function writeDesign(design: Design, { create = false } = {}): Promise<Design> {
  const file = fileFor(DESIGNS_DIR, design.id);
  let currentRev: number | undefined;
  try {
    currentRev = (await readDesign(design.id)).rev;
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  if (create && currentRev !== undefined) throw new ConflictError(`"${design.id}" already exists`);
  if (!create && currentRev === undefined) throw new NotFoundError(`"${design.id}" not found`);
  if (!create && currentRev !== design.rev) throw new ConflictError(`"${design.id}" changed on disk (rev ${currentRev})`);

  const next = parseDesign({ ...design, rev: create ? 0 : design.rev + 1 });
  // Write then rename so the file watcher never sees a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n');
  await fs.rename(tmp, file);
  return next;
}

/** `id`, or `id-2`, `id-3`… when a design already has it. */
async function freeId(id: string) {
  const taken = async (x: string) => readDesign(x).then(() => true, (e) => (e instanceof NotFoundError ? false : Promise.reject(e)));
  let next = id;
  for (let n = 2; await taken(next); n++) next = `${id}-${n}`;
  return next;
}

/** Adds a design from a file (an export, or a copy from another machine) under a free id. */
export async function importDesign(raw: unknown) {
  const d = parseDesign(raw);
  return writeDesign({ ...d, id: await freeId(d.id) }, { create: true });
}

/** Moves a design to the trash folder, from where it can be restored; nothing is deleted. */
export async function trashDesign(id: string) {
  const file = fileFor(DESIGNS_DIR, id);
  await readDesign(id);
  await fs.mkdir(TRASH_DIR, { recursive: true });
  await fs.rename(file, path.join(TRASH_DIR, `${id}.${Date.now()}.json`));
}

/** A trash entry is "<id>.<time deleted>"; anything else is refused, which keeps paths inside the trash folder. */
function trashEntry(entry: string) {
  const m = /^(.+)\.(\d+)$/.exec(entry);
  if (!m || !isId(m[1])) throw new Error(`invalid id "${entry}"`);
  return { id: m[1], deleted: Number(m[2]), file: path.join(TRASH_DIR, `${entry}.json`) };
}

export async function listTrash() {
  const files = await fs.readdir(TRASH_DIR).catch(() => [] as string[]);
  const out = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    try {
      const t = trashEntry(f.slice(0, -5));
      const d = parseDesign(JSON.parse(await fs.readFile(t.file, 'utf8')));
      out.push({ entry: f.slice(0, -5), id: t.id, title: d.title, deleted: t.deleted });
    } catch {
      // Not ours, or unreadable: leave it out rather than hide the rest.
    }
  }
  return out.sort((a, b) => b.deleted - a.deleted);
}

/** Puts a trashed design back under its id; refuses when a design has taken that id since. */
export async function restoreDesign(entry: string) {
  const t = trashEntry(entry);
  const d = parseDesign(JSON.parse(await fs.readFile(t.file, 'utf8').catch(() => Promise.reject(new NotFoundError(`"${entry}" is not in the trash`)))));
  if (await readDesign(t.id).then(() => true, () => false)) throw new ConflictError(`A design called "${t.id}" exists; rename or delete it first.`);
  await fs.rename(t.file, fileFor(DESIGNS_DIR, t.id));
  return d;
}

export async function createDesign(input: { id: string; title: string; description?: string; template?: string; from?: string; repo?: string; currency?: string }) {
  let base: Design;
  if (input.from) {
    // A copy keeps everything, its review state included.
    base = await readDesign(input.from);
  } else if (input.template) {
    base = await readFrom(TEMPLATES_DIR, input.template);
    base.steps = base.steps.map((s) => ({ ...s, seen: false }));
  } else {
    base = blankDesign(input.id, input.title);
  }
  return writeDesign(
    {
      ...base,
      id: input.id,
      title: input.title,
      description: input.description ?? base.description,
      template: input.template ?? base.template,
      repo: input.repo ?? base.repo,
      currency: input.currency ?? base.currency,
    },
    { create: true },
  );
}

/** Read, change and write a design, retrying if someone else wrote in between. */
export async function updateDesign(id: string, change: (d: Design) => void): Promise<Design> {
  for (let attempt = 0; ; attempt++) {
    const d = structuredClone(await readDesign(id));
    change(d);
    try {
      return await writeDesign(d);
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt >= 3) throw e;
    }
  }
}
