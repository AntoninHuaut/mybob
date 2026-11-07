import { expect, test } from '@playwright/test';

// Chaque test part d'un stockage vide : la carte de démarrage est donc visible.
test('la carte propose trois actions, reste ouverte pendant qu’on les essaie et ne revient pas', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-start-action]')).toHaveCount(3);
  await card.getByRole('button', { name: /Voir le plan/ }).click();
  await expect(page.locator('#view-title')).toHaveText('Plan de la maison');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Masquer les premiers pas' }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.locator('#start-card')).toBeHidden();
});

test('un clic dans la scène ne fait pas disparaître la carte', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card).toBeVisible();
});

test('tourner autour de la maison ne lève aucune erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Tourner autour de la maison/ }).click();
  await expect(card).toBeVisible();
  await page.waitForTimeout(2200);
  expect(errors).toEqual([]);
});

test('la rotation d’aperçu reste immédiate quand le mouvement est réduit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Tourner autour de la maison/ }).click();
  await expect(card).toBeVisible();
  await page.waitForTimeout(600);
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
