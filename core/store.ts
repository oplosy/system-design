import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isId, parseDesign, type Design } from './schema.ts';

// import.meta.url (not dirname) survives Vite bundling this file into its config.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DESIGNS_DIR = process.env.SYSTEM_DESIGN_DIR ?? path.join(ROOT, 'designs');
export const TEMPLATES_DIR = path.join(ROOT, 'templates');

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
      out.push({ id: d.id, title: d.title, description: d.description, steps: d.steps.length, unseen: d.steps.filter((s) => !s.seen).length });
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

export async function createDesign(input: { id: string; title: string; description?: string; template?: string }) {
  let base: Design;
  if (input.template) {
    base = await readFrom(TEMPLATES_DIR, input.template);
    base.steps = base.steps.map((s) => ({ ...s, seen: false }));
  } else {
    base = {
      id: input.id,
      title: input.title,
      rev: 0,
      steps: [{ id: 'start', title: 'Start', seen: true }],
      components: [],
      connections: [],
      notes: [],
      decisions: [],
      boundaries: [],
    };
  }
  return writeDesign(
    { ...base, id: input.id, title: input.title, description: input.description ?? base.description, template: input.template },
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
