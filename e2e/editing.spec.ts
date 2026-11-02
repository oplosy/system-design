import { expect, test } from '@playwright/test';
import { centerOf, more, openCopy, openDetails, openParts, saved } from './helpers.ts';

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
  await openDetails(page);
  await page.getByPlaceholder('Add a comment').fill('Why a single server?');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Why a single server?')).toBeVisible();
  await expect.poll(count).toBe(before + 1);
});

test('Opens starts a new design for what is inside a part and links it', async ({ page, request }) => {
  await openCopy(page, request, 'inside-copy');
  await page.locator('.react-flow__node', { hasText: 'App server' }).click();
  await page.getByLabel('Design that shows the inside').selectOption({ label: 'New design…' });
  await expect.poll(async () => (await saved(request, 'inside-copy')).components.find((c) => c.id === 'app')?.detail).toBe('inside-copy-app');
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
  await (await openParts(page)).fill('vpc');
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
  await more(page, 'Present');
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
  const search = await openParts(page);
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
  await expect(search).toHaveCount(0);
  await expect.poll(parts).toBe(before + 1);
});

test('double-clicking a part renames it in place and the name is saved', async ({ page, request }) => {
  await openCopy(page, request, 'rename-copy');
  const label = async () => (await saved(request, 'rename-copy')).components.find((c) => c.id === 'app')?.label;
  // The first click selects the part and redraws it; the pair of clicks a person makes is far enough apart for that to finish.
  const at = await centerOf(page, '.react-flow__node', 'App server');
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/#rename-copy\/app$/);
  await page.waitForTimeout(300);
  await page.mouse.dblclick(at.x, at.y);
  const box = page.locator('.inline-edit');
  await expect(box).toBeVisible();
  await box.fill('Web server');
  await box.press('Enter');
  await expect(page.locator('.react-flow__node', { hasText: 'Web server' })).toBeVisible();
  await expect.poll(label).toBe('Web server');
});

test('a flow is drawn by clicking connected parts in order, then saved', async ({ page, request }) => {
  await openCopy(page, request, 'flow-copy');
  const flows = async () => (await saved(request, 'flow-copy')).flows ?? [];
  await openDetails(page);
  await page.getByRole('button', { name: 'New flow' }).click();
  await page.getByLabel('Flow title').fill('Open the app');
  for (const name of ['Browser', 'App server', 'Database']) await page.locator('.react-flow__node', { hasText: name }).click();
  await page.getByRole('button', { name: 'Save flow' }).click();
  await expect.poll(async () => (await flows()).map((f) => `${f.title}:${f.path.join('>')}`)).toEqual(['Open the app:client>app>db']);
});

test('dragging a boundary by its tab carries the parts inside it', async ({ page, request }) => {
  await openCopy(page, request, 'box-move-copy', {
    nodes: 4,
    edit: (d) => {
      d.boundaries = [{ id: 'private', kind: 'vpc', label: 'Private network', step: 'single' }];
      d.components = (d.components as { id: string }[]).map((c) => (c.id === 'app' || c.id === 'db' ? { ...c, boundary: 'private' } : c));
    },
  });
  const at = async () => Object.fromEntries((await saved(request, 'box-move-copy')).components.map((c) => [c.id, c.position!]));
  const before = await at();
  const tab = await centerOf(page, '.boundary-tab');
  await page.mouse.move(tab.x, tab.y);
  await page.mouse.down();
  await page.mouse.move(tab.x + 60, tab.y + 10, { steps: 6 });
  await page.mouse.move(tab.x + 140, tab.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await at()).app.x - before.app.x).toBeGreaterThan(80);
  const after = await at();
  expect(Math.round(after.db.x - before.db.x)).toBe(Math.round(after.app.x - before.app.x));
  expect(after.client).toEqual(before.client);
});
