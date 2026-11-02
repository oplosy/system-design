import { expect, test, type Page } from '@playwright/test';
import { more, openDetails, openParts } from './helpers.ts';

// Every test fails on a console error or an uncaught exception: a missing import after a refactor shows up there first.
test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  (page as Page & { problems: string[] }).problems = problems;
  await page.goto('/#three-tier');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test.afterEach(({ page }) => {
  expect((page as Page & { problems: string[] }).problems).toEqual([]);
});

test('the design opens with only the sheet, the + and the review bar', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Add a part', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve/ })).toBeVisible();
  await expect(page.getByPlaceholder('Search parts')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect(page.locator('.review-sheet')).toHaveCount(0);
});

test('the menu opens its pages and closes', async ({ page }) => {
  for (const name of ['Appearance', 'Export', 'Layout']) {
    await more(page, name);
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  }
});

test('the overview map is off until asked for, and stays as chosen', async ({ page }) => {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Overview map/ }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
});

test('Ctrl+F opens the find box, Esc closes it, and / opens the parts', async ({ page }) => {
  await page.keyboard.press('Control+f');
  const find = page.getByPlaceholder('Find on sheet');
  await expect(find).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(find).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Search parts')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search parts')).toHaveCount(0);
});

test('a step with decisions opens with its details and keeps them closed once closed', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.review-sheet')).toContainText('Cache-aside with a short TTL');
  const title = page.getByRole('region', { name: 'Step review' }).locator('.review-title');
  await title.click();
  await expect(page.locator('.review-sheet')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.review-sheet')).toHaveCount(0);
});

test('Show changes lives in the step details and Request changes in the bar', async ({ page }) => {
  await openDetails(page);
  await page.getByRole('button', { name: 'Show changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show changes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(page.getByLabel(/What should change/)).toBeFocused();
});

test('selecting a part opens its inspector', async ({ page }) => {
  await page.locator('.react-flow__node', { hasText: 'App server' }).click();
  await expect(page).toHaveURL(/#three-tier\/app$/);
  await expect(page.getByText('Technology', { exact: true })).toBeVisible();
  await expect(page.getByText('If it fails')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card')).toHaveCount(0);
});

test('presenting shows the present bar and exits', async ({ page }) => {
  await more(page, 'Present');
  const exit = page.getByRole('button', { name: /^Exit/ });
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(exit).toHaveCount(0);
});

test('the design switcher opens connections, all designs and a new design', async ({ page }) => {
  const open = async (item: RegExp, heading: RegExp) => {
    await page.getByRole('button', { name: /^Three-tier web app/ }).click();
    await page.getByRole('button', { name: item }).click();
    await expect(page.getByRole('dialog').getByText(heading).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await open(/^Connections/, /^Connections/);
  await open(/^All designs/, /^Designs/);
  await page.getByRole('button', { name: /^Three-tier web app/ }).click();
  await page.getByRole('button', { name: 'New design', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Blank sheet')).toBeVisible();
});

test('palette search finds the parts added later, in their own kit', async ({ page }) => {
  const search = await openParts(page);
  await search.fill('dead letter');
  await expect(page.getByText('Dead-letter queue')).toBeVisible();
  await search.fill('lifeline');
  await expect(page.getByText('Lifeline', { exact: true })).toBeVisible();
  await search.fill('mcp');
  await expect(page.getByText('MCP server')).toBeVisible();
});

test('an edit is saved to disk and undo takes it back', async ({ page, request }) => {
  const components = async () => ((await (await request.get('/api/designs/three-tier')).json()) as { components: unknown[] }).components.length;
  // The design holds more parts than the first step shows, so count against what is on disk now.
  const before = await components();
  await openParts(page);
  await page.getByRole('button', { name: /^User/ }).first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.getByPlaceholder('Search parts')).toHaveCount(0);
  await expect.poll(components).toBe(before + 1);
  await more(page, 'Undo');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect.poll(components).toBe(before);
});

test('export downloads a file named after the design', async ({ page }) => {
  await more(page, 'Export');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.menu').getByText('Mermaid', { exact: false }).first().click()]);
  expect(download.suggestedFilename()).toBe('three-tier.mmd');
});

test('pasting a Mermaid flowchart adds a step, and undo removes it', async ({ page, request }) => {
  const steps = async () => ((await (await request.get('/api/designs/three-tier')).json()) as { steps: unknown[] }).steps.length;
  const before = await steps();
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'flowchart LR\n  a[Mailer] --> b[(Orders DB)]');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(steps).toBe(before + 1);
  await more(page, 'Undo');
  await expect.poll(steps).toBe(before);
});

test('the clean style is the default and has no hatching; sketch hatching is clipped to the shape', async ({ page }) => {
  const hatched = page.locator('.react-flow__node path[clip-path]');
  await expect(hatched).toHaveCount(0);
  await more(page, 'Appearance');
  await page.getByRole('radio', { name: 'Sketch' }).click();
  await expect(hatched.first()).toBeAttached();
});
