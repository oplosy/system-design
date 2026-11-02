import { expect, test } from '@playwright/test';
import { openCopy } from './helpers.ts';

test('a design that cannot be drawn offers a way out instead of a blank window', async ({ page, request }) => {
  await openCopy(page, request, 'crash-copy');
  await page.route('**/api/designs/crash-copy', async (route) => {
    const res = await route.fetch();
    const design = await res.json();
    design.components[0].type = 'no-such-shape';
    await route.fulfill({ response: res, json: design });
  });
  await page.reload();
  await expect(page.getByRole('alert').getByRole('heading', { name: 'The app stopped' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave this design' }).click();
  await expect(page.locator('.switcher-btn')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The app stopped' })).toHaveCount(0);
});

test('a dialog keeps Tab inside, closes on Escape and gives focus back', async ({ page, request }) => {
  await openCopy(page, request, 'modal-copy');
  await page.locator('.switcher-btn').click();
  await page.getByRole('button', { name: 'All designs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Designs' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the theme choice in the menu is a real menu item', async ({ page, request }) => {
  await openCopy(page, request, 'menu-copy');
  await page.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('group', { name: 'Theme' }).getByRole('menuitemradio', { name: 'Light' })).toBeVisible();
});
