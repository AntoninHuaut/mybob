import { expect, test } from '@playwright/test';

// Chaque test part d'un stockage vide : la carte de démarrage est donc visible.
test('la carte de démarrage propose trois actions et ne revient pas', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-start-action]')).toHaveCount(3);
  await card.getByRole('button', { name: /Voir le plan/ }).click();
  await expect(card).toBeHidden();
  await expect(page.locator('#view-title')).toHaveText('Plan de la maison');
  await page.reload();
  await expect(page.locator('#start-card')).toBeHidden();
});

test('tourner autour de la maison ne lève aucune erreur et referme la carte', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Tourner autour de la maison/ }).click();
  await expect(card).toBeHidden();
  await page.waitForTimeout(2200);
  expect(errors).toEqual([]);
});

test('l’aide courte tient en trois gestes et mène au texte détaillé', async ({ page }) => {
  await page.goto('/');
  await page.locator('#help').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.first-steps-list li')).toHaveCount(3);
  await dialog.getByRole('button', { name: /Tout voir/ }).click();
  await expect(dialog.locator('.help-grid')).toBeVisible();
});
