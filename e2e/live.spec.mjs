import { URL } from 'node:url';
import { test, expect } from './deps.mjs';
test('real server: sign in, respond, isolate and reopen repairs in both disasters', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?backend=server');
  await page.getByLabel('Email', { exact: true }).fill('admin@bastion.demo');
  await page.getByLabel('Password', { exact: true }).fill('bastion-demo');
  const cataloguePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/scenarios' && r.ok(),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const catalogue = await (await cataloguePromise).json();
  const roads = [];
  for (const id of ['flash-flood-johnson-creek', 'earthquake-portland-hills']) {
    if (roads.length) await page.getByRole('button', { name: 'New exercise', exact: true }).click();
    const index = catalogue.findIndex((s) => s.id === id);
    expect(index).toBeGreaterThanOrEqual(0);
    // Until the owner adds scenario IDs, derive the matching button from the actual catalog order.
    await page.locator('.scenario-options button').nth(index).click();
    await page.getByRole('button', { name: 'Enter command' }).click();
    await page.getByLabel('Simulation speed').selectOption('60');
    await page.getByRole('button', { name: /^response$/i }).click();
    await expect(page.locator('.decision .status.executed').first()).toBeVisible();
    if (!roads.length) {
      await page.getByRole('button', { name: 'Grid', exact: true }).click();
      await expect(
        page.locator('.grid-section').filter({ hasText: 'isolated' }).first(),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: /^recovery$/i }).click();
    const expected = id.startsWith('flash')
      ? 'Southeast Mailwell Drive'
      : 'Southwest Arnold Street';
    const option = page.locator('.recovery-option').filter({ hasText: expected });
    await expect(option).toBeVisible({ timeout: 60000 });
    roads.push(await option.locator('h3').textContent());
    await option.getByRole('button', { name: 'Issue work order', exact: true }).click();
    await expect(
      page.locator('.work-order').filter({ hasText: expected }).locator('.tag'),
    ).toHaveText('reopened', { timeout: 60000 });
  }
  expect(roads[0]).not.toBe(roads[1]);
  expect(errors).toEqual([]);
});
