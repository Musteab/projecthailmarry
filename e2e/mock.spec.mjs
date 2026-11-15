import { test, expect } from './deps.mjs';
test('mock flood response, recovery reopening and earthquake switching', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter command' }).click();
  await page.getByRole('button', { name: /Protect.*01:00/ }).click();
  await expect(page.locator('.decision .status.executed').first()).toBeVisible();
  await expect(page.locator('.metric.amber b')).toHaveText('720');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.grid-section .tag').first()).toHaveText('isolated');
  await page.getByRole('button', { name: /Restore.*03:25/ }).click();
  await page.getByRole('button', { name: /^recovery$/i }).click();
  await expect(page.locator('.recovery-option').first()).toContainText('RECOMMENDED');
  await page.getByRole('button', { name: 'Issue work order', exact: true }).first().click();
  for (const name of [
    'Mark assigned',
    'Mark in progress',
    'Mark inspection',
    'Pass inspection & reopen',
  ])
    await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.work-order .tag').first()).toHaveText('reopened');
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  await page.getByRole('button', { name: /Earthquake stress test/ }).click();
  await page.getByRole('button', { name: 'Enter command' }).click();
  await page.getByRole('button', { name: /Dispatch.*00:40/ }).click();
  await expect(page.locator('.metric-bar')).toContainText('SEISMIC RESPONSE');
  await expect(page.locator('.decision .status.failed')).toHaveCount(0);
  await page
    .getByRole('button', { name: /Restore/ })
    .last()
    .click();
  await page.getByRole('button', { name: /^recovery$/i }).click();
  // Bundled local scenes share repair roads; the live journey verifies distinct priorities.
  await expect(page.locator('.recovery-option').first()).toContainText('RECOMMENDED');
  expect(errors).toEqual([]);
});
