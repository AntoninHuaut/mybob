import { expect, test } from '@playwright/test';

// No headset here: the browser's WebXR entry point is faked, to check the wiring only.

test('without WebXR, the headset button stays hidden', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-title')).toHaveText('Vue 3D');
  await expect(page.locator('#enter-immersive')).toBeHidden();
});

test('a refused headset session leaves the screen walk running, with a message', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        isSessionSupported: async (mode: string) => mode === 'immersive-vr',
        requestSession: async () => {
          throw new DOMException('No headset', 'NotSupportedError');
        },
      }),
    });
  });
  await page.goto('/');
  const button = page.locator('#enter-immersive');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#toast')).toContainText('Le casque n’a pas pu ouvrir la visite');
  await expect(page.locator('#view-title')).toHaveText('Visite intérieure');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
