import { expect, test } from '@playwright/test';
import { centerOf, openCopy, saved } from './helpers.ts';

const position = async (request: Parameters<typeof saved>[0], id: string, part: string) => (await saved(request, id)).components.find((c) => c.id === part)?.position;

test('dragging a part moves it and the new place is saved', async ({ page, request }) => {
  await openCopy(page, request, 'drag-copy');
  const before = await position(request, 'drag-copy', 'app');
  const from = await centerOf(page, '.react-flow__node', 'App server');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 10, { steps: 8 });
  await page.mouse.move(from.x + 160, from.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await position(request, 'drag-copy', 'app'))).not.toBe(JSON.stringify(before));
  const after = await position(request, 'drag-copy', 'app');
  expect(after!.x).toBeGreaterThan(before!.x + 100);
});

test('drawing a line from one part to another adds a connection', async ({ page, request }) => {
  await openCopy(page, request, 'connect-copy');
  const count = async () => (await saved(request, 'connect-copy')).connections.length;
  const before = await count();
  const handle = await centerOf(page, '.react-flow__node:has-text("Browser") .react-flow__handle.source');
  const target = await centerOf(page, '.react-flow__node:has-text("Database") .react-flow__handle.target');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move((handle.x + target.x) / 2, (handle.y + target.y) / 2, { steps: 8 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(count).toBe(before + 1);
});

test('a comment on the step is saved', async ({ page, request }) => {
  await openCopy(page, request, 'comment-copy');
  const count = async () => ((await saved(request, 'comment-copy')).comments ?? []).length;
  const before = await count();
  await page.getByPlaceholder('Comment on this step for the agent').fill('Why a single server?');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Why a single server?')).toBeVisible();
  await expect.poll(count).toBe(before + 1);
});

test('Delete removes the selected part, Ctrl+Z brings it back, copy and paste duplicates it', async ({ page, request }) => {
  await openCopy(page, request, 'keys-copy');
  const parts = async () => (await saved(request, 'keys-copy')).components.length;
  const before = await parts();
  await page.locator('.react-flow__node', { hasText: 'App server' }).click();
  await expect(page).toHaveURL(/#keys-copy\/app$/);
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect.poll(parts).toBe(before - 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect.poll(parts).toBe(before);
  await page.locator('.react-flow__node', { hasText: 'Database' }).click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect.poll(parts).toBe(before + 1);
});

test('adding a boundary from the palette puts a box on the sheet and saves it', async ({ page, request }) => {
  await openCopy(page, request, 'box-copy');
  const boxes = async () => ((await saved(request, 'box-copy')).boundaries ?? []).length;
  const before = await boxes();
  await page.getByPlaceholder(/^Search: /).fill('vpc');
  await page.getByRole('button', { name: /^VPC/ }).first().click();
  await expect(page.locator('.react-flow__node-boundary')).toHaveCount(1);
  await expect.poll(boxes).toBe(before + 1);
});

test('Ctrl-click selects several parts and Delete removes them together', async ({ page, request }) => {
  await openCopy(page, request, 'multi-copy');
  const parts = async () => (await saved(request, 'multi-copy')).components.length;
  const before = await parts();
  await page.locator('.react-flow__node', { hasText: 'Browser' }).click();
  await page.locator('.react-flow__node', { hasText: 'Database' }).click({ modifiers: ['Control'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect.poll(parts).toBe(before - 2);
});

test('presenting walks the steps with the arrow keys and Escape leaves', async ({ page, request }) => {
  await openCopy(page, request, 'present-copy', { seen: true });
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const counter = page.getByRole('region', { name: 'Presentation' }).locator('.present-no');
  await expect(counter).toHaveText('03/03');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('02/03');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('01/03');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('02/03');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Presentation' })).toHaveCount(0);
});

test('palette search lists name matches first and Enter adds the closest one', async ({ page, request }) => {
  await openCopy(page, request, 'search-copy');
  const search = page.getByPlaceholder(/^Search: /);
  await search.fill('gateway');
  // Inside each group the parts with the word in their name come before the ones that only list it as a keyword.
  const groups = await page.locator('.palette-scroll section').evaluateAll((sections) => sections.map((s) => [...s.querySelectorAll('.part-name')].map((n) => n.textContent ?? '')));
  const named = groups.filter((names) => names.some((n) => /gateway/i.test(n)));
  expect(named.length).toBeGreaterThan(0);
  for (const names of groups) {
    const firstOther = names.findIndex((n) => !/gateway/i.test(n));
    if (firstOther >= 0) expect(names.slice(firstOther).every((n) => !/gateway/i.test(n))).toBe(true);
  }
  // A group that has a name match is listed before one that only has keyword matches.
  const lastNamed = groups.map((names) => names.some((n) => /gateway/i.test(n))).lastIndexOf(true);
  expect(groups.slice(0, lastNamed + 1).every((names) => names.some((n) => /gateway/i.test(n)))).toBe(true);
  const parts = async () => (await saved(request, 'search-copy')).components.length;
  const before = await parts();
  await search.fill('queue');
  await expect(page.locator('.palette .part-name').first()).toHaveText('Queue');
  await search.press('Enter');
  await expect(search).toHaveValue('');
  await expect.poll(parts).toBe(before + 1);
});
