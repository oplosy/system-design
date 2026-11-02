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
