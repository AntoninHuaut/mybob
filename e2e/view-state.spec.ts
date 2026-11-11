import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function importHouse(page: Page) {
  const project = JSON.parse(await readFile('public/projects/maison-atelier.json', 'utf8'));
  project.levels.push({
    ...JSON.parse(JSON.stringify(project.levels[0]), (key, value) =>
      key === 'id' || key.endsWith('Id') ? `upper-${value}` : value,
    ),
    id: 'upper-test',
    name: 'Upper test level',
    elevation: 3,
  });
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#import-file').setInputFiles({
    name: 'view-state.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('#project-select')).toHaveValue(project.id);
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#view-title')).toHaveText('Vue 3D');
});

test('view controls and project/level reload derive chrome from the accepted view', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await importHouse(page);
  await page.locator('#view-exterior').click();
  await expect(page.locator('#view-title')).toHaveText('Extérieur');
  await expect(page.locator('#view-exterior')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-view=overview]')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('exterior.png') });
  await page.locator('[data-view=plan]').click();
  await expect(page.locator('#view-title')).toHaveText('Plan de la maison');
  await expect(page.locator('#view-exterior')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('plan.png') });
  await page.locator('[data-view=walk]').click();
  await expect(page.locator('#view-title')).toHaveText('Visite intérieure');
  await expect(page.locator('#viewport')).toHaveClass(/walking/);
  await page.screenshot({ path: testInfo.outputPath('walk.png') });
  for (const level of ['upper-test', 'atelier-rdc', 'upper-test']) {
    await page.locator('#level-select').selectOption(level);
    await expect(page.locator('#view-title')).toHaveText('Vue 3D');
    await expect(page.locator('#viewport')).not.toHaveClass(/walking/);
    await expect(page.locator('[data-view=overview]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-view=walk]').click();
    await expect(page.locator('#view-title')).toHaveText('Visite intérieure');
  }
  await page.locator('#view-exterior').click();
  await page.locator('#project-select').selectOption('studio-demo');
  await expect(page.locator('#view-title')).toHaveText('Vue 3D');
  await expect(page.locator('#view-exterior')).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe('touch-only navigation', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('refused walking preserves exterior chrome and allows the next plan transition', async ({
    page,
  }) => {
    await importHouse(page);
    await page.locator('#view-exterior').click();
    await page.locator('[data-view=walk]').click();
    await expect(page.locator('#info-dialog')).toBeVisible();
    await expect(page.locator('#view-title')).toHaveText('Extérieur');
    await expect(page.locator('#view-exterior')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-view=walk]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#viewport')).not.toHaveClass(/walking/);
    await page.locator('#close-dialog').click();
    await page.locator('[data-view=plan]').click();
    await expect(page.locator('[data-view=plan]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#view-exterior')).toHaveAttribute('aria-pressed', 'false');
  });
});
