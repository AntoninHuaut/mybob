import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { drawClearRoom, pagePoint } from './planDrawing';
import { startupDone } from './startup';

type Point = [number, number];
interface ExportedLevel {
  walls: {
    id: string;
    start: Point;
    end: Point;
    exterior?: boolean;
    openings?: { kind: string; offset: number; width: number; swing?: number }[];
  }[];
  rooms: { id: string; name: string; polygon: Point[] }[];
}

const area = (polygon: Point[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length];
      return sum + x * nz - nx * z;
    }, 0) / 2,
  );

async function exportedLevel(page: Page): Promise<ExportedLevel> {
  const event = page.waitForEvent('download');
  await page.locator('#export-project').click();
  const path = await (await event).path();
  return JSON.parse(await readFile(path!, 'utf8')).levels[0];
}

const partition = (level: ExportedLevel) => level.walls.find((w) => !w.exterior)!;

async function openOpenings(page: Page) {
  await page.locator('#tool-openings').click();
  // The partition is the fifth wall, after the four of the rectangle.
  await page.locator('#opening-form [name=wall]').selectOption({ index: 4 });
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await startupDone(page);
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

test('design two rooms in Plan, then walk through their door in Visite', async ({ page }) => {
  // A drawing, dialogs, a reload and a software-rendered walk on CI.
  test.slow();
  const [x0, z0] = await drawClearRoom(page);
  await expect(page.locator('#plan-edit-bar')).toBeVisible();
  const first = await exportedLevel(page);
  expect(first.rooms.map((r) => area(r.polygon))).toEqual([expect.closeTo(12, 6)]);

  // The start faces +z (yaw 0): a partition across the depth puts the door straight ahead.
  // Its axis 1.9 m from the top axis leaves 1.75 m on the start side, 1.15 m beyond.
  for (const target of [
    [x0, z0 + 1.9],
    [x0 + 4.2, z0 + 1.9],
  ] as Point[]) {
    const [x, y] = await pagePoint(page, target);
    await page.mouse.click(x, y);
  }
  await expect(page.locator('#wall-draft .wall-draft-joint')).toHaveCount(6);
  const divided = await exportedLevel(page);
  expect(partition(divided).start[1]).toBeCloseTo(z0 + 1.9, 6);
  expect(divided.rooms.map((r) => area(r.polygon))).toEqual([
    expect.closeTo(7, 6),
    expect.closeTo(4.6, 6),
  ]);

  await openOpenings(page);
  await page.locator('#opening-form [name=distance]').fill('1.65');
  await page.locator('#opening-form [name=width]').fill('0.9');
  await page.locator('#opening-form [type=submit]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('#move-wall').click();
  await page.locator('#move-partition [name=delta]').fill('0.2');
  await page.getByRole('button', { name: 'Appliquer le déplacement' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved = await exportedLevel(page);
  expect(partition(moved).start[1]).toBeCloseTo(z0 + 2.1, 6);

  await page.getByRole('button', { name: 'Annuler la modification du plan' }).click();
  expect(partition(await exportedLevel(page)).start[1]).toBeCloseTo(z0 + 1.9, 6);
  await page.getByRole('button', { name: 'Rétablir la modification du plan' }).click();
  expect(await exportedLevel(page)).toEqual(moved);

  // An opening wider than its host is refused and the house stays as it was.
  await openOpenings(page);
  await page.locator('#opening-form [name=width]').fill('5');
  await page.locator('#opening-form [type=submit]').click();
  await expect(page.locator('#opening-error')).not.toBeEmpty();
  await page.locator('#cancel-opening').click();
  expect(await exportedLevel(page)).toEqual(moved);

  await page.reload();
  await startupDone(page);
  await expect(page.locator('#header-project')).toHaveText('Nouvelle maison');
  const level = await exportedLevel(page);
  expect(level).toEqual(moved);
  // The larger part kept the drawn room's identity.
  const [start, beyond] = level.rooms;
  expect(start.id).toBe(first.rooms[0].id);
  expect(area(start.polygon)).toBeCloseTo(7.8, 6);
  expect(area(beyond.polygon)).toBeCloseTo(3.8, 6);
  const door = partition(level).openings![0];
  expect(door).toMatchObject({ kind: 'door', offset: 1.65, width: 0.9, swing: 1 });

  await page.getByRole('button', { name: 'Visite', exact: true }).click();
  const viewport = page.locator('#viewport');
  await expect(viewport).toHaveAttribute('data-walk-room', start.id);
  await page.locator('#scene').focus();
  await page.keyboard.press('KeyE');
  await page.keyboard.down('KeyW');
  await expect(viewport).toHaveAttribute('data-walk-room', beyond.id, { timeout: 15_000 });
  await page.keyboard.up('KeyW');
});
