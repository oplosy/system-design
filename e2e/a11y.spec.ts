import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openCopy } from './helpers.ts';

/** axe can't judge contrast over a blurred backdrop, so panels are made solid first; the text on them stays the same. */
async function scan(page: Page) {
  await page.addStyleTag({ content: ':root { --glass: var(--panel); } * { backdrop-filter: none !important; animation: none !important; }' });
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page, request }) => {
      await page.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
      await openCopy(page, request, `a11y-${theme}`);
    });

    test('the sheet has no accessibility violations', async ({ page }) => {
      await scan(page);
    });

    test('the More menu has no accessibility violations', async ({ page }) => {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
      await scan(page);
    });

    test('a selected part has no accessibility violations', async ({ page }) => {
      await page.locator('.react-flow__node').first().click();
      await expect(page.getByRole('complementary', { name: 'Selected item' })).toBeVisible();
      await scan(page);
    });

    test('the Designs dialog has no accessibility violations', async ({ page }) => {
      await page.locator('.switcher-btn').click();
      await page.getByRole('button', { name: 'All designs' }).click();
      await expect(page.getByRole('dialog', { name: 'Designs' })).toBeVisible();
      await scan(page);
    });
  });
}
