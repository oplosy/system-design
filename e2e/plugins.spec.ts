import { expect, test } from '@playwright/test';
import { more, openCopy, saved } from './helpers.ts';

// The server loads examples/plugins/service-list.mjs: a "# services" importer, a CSV exporter and a ticket link.

test('a plugin format appears in the Export menu and downloads its file', async ({ page, request }) => {
  await openCopy(page, request, 'plugin-export-copy');
  await more(page, 'Export');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.menu').getByText('Parts as CSV').click()]);
  expect(download.suggestedFilename()).toBe('plugin-export-copy.csv');
  const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
  expect(text.split('\n')[0]).toBe('id,type,label');
  expect(text).toContain('app,service,"App server"');
});

test('pasting a format only a plugin knows adds its parts as a step', async ({ page, request }) => {
  await openCopy(page, request, 'plugin-import-copy');
  const steps = async () => (await (await request.get('/api/designs/plugin-import-copy')).json()) as { steps: unknown[]; components: unknown[] };
  const before = await steps();
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '# services\nweb -> api\napi -> orders');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await steps()).components.length).toBe(before.components.length + 3);
  expect((await steps()).steps.length).toBe(before.steps.length + 1);
});

test('a plugin turns a ticket number into a link', async ({ page, request }) => {
  await openCopy(page, request, 'plugin-link-copy', {
    edit: (d) => {
      d.components = (d.components as { id: string }[]).map((c) => (c.id === 'app' ? { ...c, refs: [{ kind: 'ticket', value: 'OPS-12' }] } : c));
    },
  });
  await page.locator('.react-flow__node', { hasText: 'App server' }).click();
  await expect(page.getByRole('link', { name: 'OPS-12' })).toHaveAttribute('href', 'https://tickets.example.com/browse/OPS-12');
  expect((await saved(request, 'plugin-link-copy')).components.length).toBeGreaterThan(0);
});

test('Connections lists the installed plugin', async ({ page, request }) => {
  await openCopy(page, request, 'plugin-list-copy');
  await page.getByRole('button', { name: /^Copy plugin-list-copy/ }).click();
  await page.getByRole('button', { name: /^Connections/ }).click();
  await page.getByRole('tab', { name: 'Plugins' }).click();
  await expect(page.getByRole('dialog').getByText('service-list')).toBeVisible();
});
