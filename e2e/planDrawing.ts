import { expect, type Page } from '@playwright/test';

type Point = [number, number];

/** Existing wall corners as the wall tool shows them: plan position and page position. */
async function joints(page: Page) {
  return page.locator('#wall-draft .wall-draft-joint').evaluateAll((circles) =>
    circles.map((c) => {
      const box = c.getBoundingClientRect();
      return {
        plan: c.getAttribute('data-point')!.split(',').map(Number) as [number, number],
        page: [box.x + box.width / 2, box.y + box.height / 2] as [number, number],
      };
    }),
  );
}

/** Corners once two readings 250 ms apart agree: the Plan may still be framing the house. */
async function settledJoints(page: Page) {
  let last = '';
  let corners: Awaited<ReturnType<typeof joints>> = [];
  await expect
    .poll(
      async () => {
        corners = await joints(page);
        const same = JSON.stringify(corners) === last;
        last = JSON.stringify(corners);
        return same;
      },
      { message: 'Plan corners stop moving', intervals: [250] },
    )
    .toBe(true);
  return corners;
}

/** Page position of a plan point, interpolated from three wall corners (Plan is orthographic). */
export async function pagePoint(page: Page, target: Point): Promise<Point> {
  const [a, b, c] = await settledJoints(page);
  // Solve target = a + s (b − a) + t (c − a) in plan, then apply it on the page.
  const [ux, uz, vx, vz] = [
    b.plan[0] - a.plan[0],
    b.plan[1] - a.plan[1],
    c.plan[0] - a.plan[0],
    c.plan[1] - a.plan[1],
  ];
  const [dx, dz] = [target[0] - a.plan[0], target[1] - a.plan[1]];
  const det = ux * vz - uz * vx;
  const s = (dx * vz - dz * vx) / det,
    t = (ux * dz - uz * dx) / det;
  return [
    a.page[0] + s * (b.page[0] - a.page[0]) + t * (c.page[0] - a.page[0]),
    a.page[1] + s * (b.page[1] - a.page[1]) + t * (c.page[1] - a.page[1]),
  ];
}

/** Clicks the Plan at a page point, first failing with whatever covers the canvas there (#374). */
export async function clickPlan(page: Page, at: Point) {
  const cover = await page.evaluate(([x, y]) => {
    const top = document.elementFromPoint(x, y);
    if (top?.id === 'scene') return '';
    return top ? `${top.tagName.toLowerCase()}#${top.id}.${[...top.classList].join('.')}` : 'none';
  }, at);
  expect(cover, 'element over the Plan canvas at the click').toBe('');
  await page.mouse.click(...at);
}

/**
 * « Nouvelle maison », then a 4 × 3 m clear room with 0.20 m walls drawn on the Plan: a first
 * corner on the 5 cm grid, then axis lengths 4.20 / 3.20 typed with arrow keys. Returns that
 * first corner, in plan metres.
 */
export async function drawClearRoom(page: Page): Promise<Point> {
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.getByRole('button', { name: 'Nouvelle maison' }).click();
  await expect(page.locator('#header-project')).toHaveText('Nouvelle maison');
  await expect(page.locator('#plan-hint')).toContainText('premier angle');
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  for (const [length, arrow] of [
    ['4.2', 'ArrowRight'],
    ['3.2', 'ArrowDown'],
    ['4.2', 'ArrowLeft'],
    ['3.2', 'ArrowUp'],
  ]) {
    await page.keyboard.type(length);
    await page.keyboard.press(arrow);
  }
  await expect(page.locator('#wall-draft .wall-draft-joint')).toHaveCount(4);
  const corners = (await joints(page)).map((j) => j.plan);
  return [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1]))];
}
