import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import path from 'node:path';

const out = process.env.DEMO_SCREENSHOTS ?? '/tmp/bastion-rehearsal';
fs.mkdirSync(out, { recursive: true });
const chrome =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined);
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const base = process.env.DEMO_URL ?? 'http://127.0.0.1:5188';
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
};
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Enter command' })).toBeEnabled({ timeout: 30000 });
  await shot('01-launcher');
  await page.getByRole('button', { name: 'Enter command' }).click();
  await page.getByRole('button', { name: /Protect.*01:00/ }).click();
  await expect(page.locator('.metric.amber b')).toHaveText('720');
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('.decision').filter({ hasText: 'Second crew requested' }).click();
  await page.getByLabel('Exercise persona').selectOption('observer');
  await expect(page.getByRole('button', { name: 'Approve action', exact: true })).toBeDisabled();
  await page.getByLabel('Exercise persona').selectOption('operator');
  await page.getByRole('button', { name: 'Approve action', exact: true }).click();
  await expect(page.locator('.detail-content .tag-row')).toContainText('executed');
  await page.getByRole('button', { name: 'Override decision', exact: true }).click();
  await page
    .getByLabel('Reason', { exact: true })
    .fill('Commander changes deployment after a verified field update.');
  await page.getByRole('button', { name: 'Record override', exact: true }).click();
  await expect(page.locator('.detail-content .tag-row')).toContainText('overridden');
  await page.getByLabel('Exercise persona').selectOption('admin');
  await page.getByRole('button', { name: /Protect.*01:00/ }).click();
  await page.locator('.decision').filter({ hasText: 'Second crew requested' }).click();
  await page.getByRole('button', { name: 'Reject with reason', exact: true }).click();
  await page
    .getByLabel('Reason', { exact: true })
    .fill('Hold this reserve crew for a second incident.');
  await page.getByRole('button', { name: 'Record reject', exact: true }).click();
  await expect(page.locator('.detail-content .tag-row')).toContainText('rejected');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.grid-section .tag').first()).toHaveText('isolated');
  await page.getByLabel('Execution policy').last().selectOption('approve');
  await expect(page.getByLabel('Execution policy').last()).toHaveValue('approve');
  await page.getByLabel('Execution policy').last().selectOption('auto');
  await page.getByRole('button', { name: /^response$/i }).click();
  await page.getByRole('button', { name: /Protect.*01:00/ }).click();
  await page.locator('.decision').filter({ hasText: 'Isolate threatened feeder' }).click();
  await page
    .getByRole('button', { name: 'Dismiss notification' })
    .click()
    .catch(() => {});
  await shot('02-sunway-command');
  await page.getByRole('button', { name: /Restore.*03:25/ }).click();
  await page.getByRole('button', { name: /^recovery$/i }).click();
  await expect(page.locator('.recovery-option')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Inspect access comparison', exact: true })
    .first()
    .click();
  await expect(page.locator('.access-compare')).toBeVisible();
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByRole('button', { name: 'After clearance', exact: true }).click();
  await page.getByRole('button', { name: 'Issue work order', exact: true }).first().click();
  for (const name of [
    'Mark assigned',
    'Mark in progress',
    'Mark inspection',
    'Pass inspection & reopen',
  ])
    await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.work-order .tag')).toHaveText('reopened');
  await page
    .getByRole('button', { name: 'Dismiss notification' })
    .click()
    .catch(() => {});
  await shot('03-recovery');
  await page.getByRole('button', { name: /Inject a disruption/ }).click();
  await page.getByRole('button', { name: 'Inject power loss', exact: true }).click();
  await page.getByRole('button', { name: 'Close disruption controls', exact: true }).click();
  await page.getByRole('button', { name: 'Brief', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh situation briefing', exact: true }).click();
  await expect(page.locator('.detail-content')).toContainText('Mock exercise briefing');
  await page.getByLabel('Situation question').fill('What needs my attention?');
  await page.getByRole('button', { name: 'Ask exercise assistant', exact: true }).click();
  await expect(page.locator('.answer')).toContainText('active incidents');
  await page.getByRole('button', { name: 'Close access comparison' }).click();
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  await page.getByRole('button', { name: /Earthquake stress test/ }).click();
  await page.getByRole('button', { name: 'Enter command' }).click();
  await page.getByRole('button', { name: /Dispatch.*00:40/ }).click();
  await expect(page.locator('.metric-bar')).toContainText('SEISMIC RESPONSE');
  await expect(page.locator('.decision .status.failed')).toHaveCount(0);
  await shot('04-sunway-earthquake');
  await page.getByLabel('Demo region').selectOption('srimuda');
  await page.getByRole('button', { name: 'Enter command' }).click();
  await page.getByRole('button', { name: /Protect.*01:00/ }).click();
  await expect(page.getByRole('heading', { name: 'Taman Sri Muda', exact: true })).toBeVisible();
  await expect(page.locator('.metric.amber b')).toHaveText('720');
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await shot('05-srimuda-command');
  await page.getByRole('button', { name: 'Presentation mode', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/presentation/);
  await shot('06-presentation');
  await page.getByRole('button', { name: /Exit presentation/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Collapse context panel', exact: true }).click();
  await shot('07-mobile');
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter command' })).toBeInViewport();
  await shot('08-mobile-launcher');
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks:
          'dispatch, permissions, approve/reject/override, utility policy, recovery comparison, work-order lifecycle, inject, briefing, earthquake, region switch, presentation, mobile',
        screenshots: out,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
