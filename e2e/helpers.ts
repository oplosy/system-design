import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DATA_DIR } from '../playwright.config.ts';

type Saved = { components: { id: string; position?: { x: number; y: number } }[]; connections: unknown[]; comments?: unknown[] };

/** A private copy of the three-tier template, so a test that edits does not change what the others open. */
export function seedCopy(id: string) {
  const template = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'templates', 'three-tier.json'), 'utf8'));
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify({ ...template, id, title: `Copy ${id}` }));
}

export const saved = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/designs/${id}`)).json()) as Saved;

/** Opens a private copy and waits until the sheet is up and its automatic layout is saved. */
export async function openCopy(page: Page, request: APIRequestContext, id: string) {
  seedCopy(id);
  await page.goto(`/#${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect.poll(async () => (await saved(request, id)).components.every((c) => c.position)).toBe(true);
}

/** The middle of an element on the page. */
export async function centerOf(page: Page, selector: string, text?: string) {
  const box = await page.locator(selector, text ? { hasText: text } : undefined).first().boundingBox();
  if (!box) throw new Error(`${selector} is not on the page`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
