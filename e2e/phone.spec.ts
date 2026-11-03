import { expect, test } from '@playwright/test';
import { centerOf, openCopy } from './helpers.ts';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

const box = async (page: import('@playwright/test').Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test('on a phone the fit button stays clear of the review bar', async ({ page, request }) => {
  await openCopy(page, request, 'phone-controls');
  const controls = await box(page, '.react-flow__controls');
  const bar = await box(page, '.review-bar');
  expect(controls.y + controls.height).toBeLessThanOrEqual(bar.y);
});

test('on a phone a part the card would cover moves up above it, and the card hides the sheet behind it', async ({ page, request }) => {
  await openCopy(page, request, 'phone-card');
  const db = await centerOf(page, '.react-flow__node', 'Database');
  await page.mouse.click(db.x, db.y);
  const card = page.locator('.card');
  await expect(card).toBeVisible();
  await expect
    .poll(async () => {
      const part = await box(page, '.react-flow__node[data-id="db"]');
      return part.y + part.height <= (await box(page, '.card')).y;
    })
    .toBe(true);
  const alpha = await card.evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.fillStyle = getComputedStyle(el).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    return c.getImageData(0, 0, 1, 1).data[3];
  });
  expect(alpha).toBe(255);
});
