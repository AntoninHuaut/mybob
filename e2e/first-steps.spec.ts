import { expect, test } from '@playwright/test';

// Every test starts from empty storage: the start card is therefore visible.
test('the card offers three actions, stays open while they are tried and does not come back', async ({
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

test('a click in the scene does not dismiss the card', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card).toBeVisible();
});

test('orbiting around the house raises no error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Tourner autour de la maison/ }).click();
  await expect(card).toBeVisible();
  await expect(page.locator('#scene')).toHaveAttribute('data-orbit-tour', 'complete');
  expect(Number(await page.locator('#scene').getAttribute('data-orbit-tour-angle'))).toBeCloseTo(
    Math.PI / 3,
  );
  expect(errors).toEqual([]);
});

test('the preview rotation stays immediate when motion is reduced', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const card = page.locator('#start-card');
  await expect(card).toBeVisible();
  const result = await card
    .getByRole('button', { name: /Tourner autour de la maison/ })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
      return { state: canvas.dataset.orbitTour, angle: Number(canvas.dataset.orbitTourAngle) };
    });
  expect(result.state).toBe('complete');
  expect(result.angle).toBeCloseTo(Math.PI / 3);
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

test('the short help fits in three gestures and leads to the detailed text', async ({ page }) => {
  await page.goto('/');
  await page.locator('#help').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.first-steps-list li')).toHaveCount(3);
  await dialog.getByRole('button', { name: /Tout voir/ }).click();
  await expect(dialog.locator('.help-grid')).toBeVisible();
});
