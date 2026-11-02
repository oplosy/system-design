import { expect, test, type APIRequestContext } from '@playwright/test';

const IDP = 'http://127.0.0.1:5193';
/** The fake provider signs in whoever was chosen last. */
const signInAs = (request: APIRequestContext, email: string) => request.post(`${IDP}/__user`, { data: { email } });
const me = async (page: import('@playwright/test').Page) => (await page.request.get('/api/me')).json() as Promise<{ email: string; canEdit: boolean }>;

test('someone on the editors list signs in and gets the whole app', async ({ page, request }) => {
  await signInAs(request, 'ann@example.com');
  await page.goto('/#three-tier');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  expect(await me(page)).toMatchObject({ email: 'ann@example.com', canEdit: true });
  await page.getByRole('button', { name: /^Three-tier web app/ }).click();
  await expect(page.getByRole('button', { name: 'New design', exact: true })).toBeVisible();
});

test('someone allowed in but not an editor can look, not change', async ({ page, request }) => {
  await signInAs(request, 'bob@example.com');
  await page.goto('/#three-tier');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  expect(await me(page)).toMatchObject({ email: 'bob@example.com', canEdit: false });
  await expect(page.getByText('View only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Three-tier web app/ }).click();
  await expect(page.getByRole('listbox', { name: 'Designs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New design', exact: true })).toHaveCount(0);
  // The server refuses a change from a viewer even when it is sent by hand.
  const design = await (await page.request.get('/api/designs/three-tier')).json();
  const save = await page.request.put('/api/designs/three-tier', { data: { ...design, title: 'Changed by a viewer' } });
  expect(save.status()).toBe(403);
});

test('someone not on the list is turned away at sign-in', async ({ page, request }) => {
  await signInAs(request, 'eve@example.com');
  await page.goto('/');
  await expect(page.getByText('eve@example.com has no access here.')).toBeVisible();
  expect((await page.request.get('/api/designs')).status()).toBe(401);
});

test('without a session the API answers 401', async ({ request }) => {
  expect((await request.get('/api/designs')).status()).toBe(401);
  expect((await request.get('/api/me')).status()).toBe(401);
});

test('a link to an item still opens that item after signing in', async ({ page, request }) => {
  await signInAs(request, 'ann@example.com');
  await page.goto('/#three-tier/app');
  await expect(page).toHaveURL(/#three-tier\/app$/);
  await expect(page.getByText('Technology', { exact: true })).toBeVisible();
});
