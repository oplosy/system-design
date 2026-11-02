import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DATA_DIR } from '../playwright.config.ts';

type Saved = { components: { id: string; position?: { x: number; y: number } }[]; connections: unknown[]; comments?: unknown[]; boundaries?: unknown[] };

/** A private copy of the three-tier template, so a test that edits does not change what the others open. */
export function seedCopy(id: string, { seen = false } = {}) {
  const template = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'templates', 'three-tier.json'), 'utf8'));
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify({ ...template, id, title: `Copy ${id}`, steps: template.steps.map((s: object) => ({ ...s, seen })) }));
}

export const saved = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/designs/${id}`)).json()) as Saved;

/** Opens a private copy and waits until the sheet is up and its automatic layout is saved. */
export async function openCopy(page: Page, request: APIRequestContext, id: string, options: { seen?: boolean } = {}) {
  seedCopy(id, options);
  await page.goto(`/#${id}`);
  // A design with every step seen opens at its last step, which shows more parts.
  if (options.seen) await expect(page.locator('.react-flow__node').first()).toBeVisible();
  else await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect.poll(async () => (await saved(request, id)).components.every((c) => c.position)).toBe(true);
}

/**
 * The middle of an element on the page, once it has stopped moving: the sheet animates to fit its parts after a layout,
 * and a slower machine is still mid-animation when a test would otherwise aim at it.
 */
export async function centerOf(page: Page, selector: string, text?: string) {
  const target = page.locator(selector, text ? { hasText: text } : undefined).first();
  let last = '';
  for (let tries = 0; tries < 40; tries++) {
    const box = await target.boundingBox();
    if (box) {
      const now = JSON.stringify([box.x, box.y, box.width, box.height].map(Math.round));
      if (now === last) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      last = now;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`${selector} never settled on the page`);
}
