import { expect, type Page } from '@playwright/test';

/** Clicks the drawing sketch at a point in plan metres. */
async function clickSketch(page: Page, x: number, z: number) {
  const target = await page.locator('#wall-chain svg').evaluate(
    (svg: SVGSVGElement, [px, pz]) => {
      const point = new DOMPoint(px, pz).matrixTransform(svg.getScreenCTM()!);
      return { x: point.x, y: point.y };
    },
    [x, z],
  );
  await page.mouse.click(target.x, target.y);
}

/**
 * Draws a 4 × 3 m clear room with 0.20 m walls through « Nouvelle maison »: four typed axis
 * lengths of 4.20 and 3.20 m, clockwise from the top-left corner, as wall-1 … wall-4.
 */
export async function drawClearRoom(page: Page, name: string) {
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.getByRole('button', { name: 'Nouvelle maison' }).click();
  const length = page.locator('#wall-chain [name=length]');
  await clickSketch(page, 1, 1);
  for (const [value, x, z] of [
    ['4.2', 3, 1],
    ['3.2', 5.2, 3],
    ['4.2', 3, 4.2],
  ] as const) {
    await length.fill(value);
    await clickSketch(page, x, z);
  }
  await page.getByRole('button', { name: 'Fermer le contour' }).click();
  await page.locator('#wall-chain [name=room]').fill(name);
  await page.getByRole('button', { name: 'Créer la maison' }).click();
  await expect(page.locator('#header-project')).toHaveText(name);
}
