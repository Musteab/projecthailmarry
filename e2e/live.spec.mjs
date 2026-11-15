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
  const loginPromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/auth/login' && r.ok(),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const { token } = await (await loginPromise).json();
  const headers = { authorization: `Bearer ${token}` };
  const catalogue = await (await cataloguePromise).json();
  const roads = [];
  for (const id of ['flash-flood-johnson-creek', 'earthquake-portland-hills']) {
    if (roads.length) await page.getByRole('button', { name: 'New exercise', exact: true }).click();
    const index = catalogue.findIndex((s) => s.id === id);
    expect(index).toBeGreaterThanOrEqual(0);
    // Until the owner adds scenario IDs, derive the matching button from the actual catalog order.
    await page.locator('.scenario-options button').nth(index).click();
    const createdPromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/operations' &&
        r.request().method() === 'POST' &&
        r.status() === 201,
    );
    await page.getByRole('button', { name: 'Enter command' }).click();
    const operation = await (await createdPromise).json();
    const operationPath = `/api/operations/${operation.id}`;
    const control = async (data) => {
      const response = await page.request.post(operationPath + '/control', { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
    };
    await control({ command: 'speed', speed: 60 });
    const expected = id.startsWith('flash')
      ? 'Southeast Mailwell Drive'
      : 'Southwest Arnold Street';
    // Pause at the actual recovery checkpoint before inspecting the UI. GPU-less runners
    // must not race a 60x simulation that could end while the browser renders its map.
    await expect
      .poll(
        async () => {
          const response = await page.request.get(operationPath, { headers });
          expect(response.ok()).toBe(true);
          const world = await response.json();
          return (
            world.restoration?.options.some((option) => option.label.includes(expected)) ?? false
          );
        },
        { timeout: 90000, intervals: [250, 500, 1000] },
      )
      .toBe(true);
    await control({ command: 'pause' });
    await expect(page.getByLabel('Simulation speed')).toHaveValue('60');
    await page.getByRole('button', { name: /^response$/i }).click();
    await expect(page.locator('.decision .status.executed').first()).toBeVisible();
    if (!roads.length) {
      await page.getByRole('button', { name: 'Grid', exact: true }).click();
      await expect(
        page.locator('.grid-section').filter({ hasText: 'isolated' }).first(),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: /^recovery$/i }).click();
    const option = page.locator('.recovery-option').filter({ hasText: expected });
    await expect(option).toBeVisible({ timeout: 60000 });
    roads.push(await option.locator('h3').textContent());
    const orderPromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === operationPath + '/work-orders' &&
        r.request().method() === 'POST',
    );
    await option.getByRole('button', { name: 'Issue work order', exact: true }).click();
    const orderResponse = await orderPromise;
    expect(orderResponse.status(), await orderResponse.text()).toBe(201);
    await page.getByRole('button', { name: 'Play exercise', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause exercise', exact: true })).toBeVisible();
    await expect(
      page.locator('.work-order').filter({ hasText: expected }).locator('.tag'),
    ).toHaveText('reopened', { timeout: 60000 });
  }
  expect(roads[0]).not.toBe(roads[1]);
  expect(errors).toEqual([]);
});
