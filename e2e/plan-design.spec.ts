import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

test('design two rooms in Plan, then walk through their door in Visite', async ({ page }) => {
  // Several dialogs, a reload and a software-rendered walk on CI.
  test.slow();
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#create-house').click();
  await page.getByLabel('Nom de la pièce').fill('Salon');
  await page.getByRole('button', { name: 'Créer et enregistrer' }).click();
  await expect(page.locator('#header-project')).toHaveText('Salon');

  // Spawn faces +z (yaw 0): a partition across the depth puts the door straight ahead.
  await page.locator('#divide-room').click();
  await page.locator('[name=wall0]').selectOption('wall-2');
  await page.locator('[name=wall1]').selectOption('wall-4');
  await page.locator('[name=offset0]').fill('1.6');
  await page.locator('[name=offset1]').fill('1.6');
  await page.getByRole('button', { name: 'Confirmer la division' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openOpenings(page);
  await page.locator('#opening-form [name=distance]').fill('1.65');
  await page.locator('#opening-form [name=width]').fill('0.9');
  await page.locator('#opening-form [type=submit]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('#move-wall').click();
  await page.locator('#move-partition [name=delta]').fill('-0.3');
  await page.getByRole('button', { name: 'Appliquer le déplacement' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved = await exportedLevel(page);
  expect(partition(moved).start[1]).toBeCloseTo(1.8, 6);

  await openOpenings(page);
  await page.getByRole('button', { name: 'Annuler la modification précédente' }).click();
  expect(partition(await exportedLevel(page)).start[1]).toBeCloseTo(1.5, 6);
  await openOpenings(page);
  await page.getByRole('button', { name: 'Rétablir' }).click();
  expect(await exportedLevel(page)).toEqual(moved);

  // An opening wider than its host is refused and the house stays as it was.
  await openOpenings(page);
  await page.locator('#opening-form [name=width]').fill('5');
  await page.locator('#opening-form [type=submit]').click();
  await expect(page.locator('#opening-error')).not.toBeEmpty();
  await page.locator('#cancel-opening').click();
  expect(await exportedLevel(page)).toEqual(moved);

  await page.reload();
  await expect(page.locator('#header-project')).toHaveText('Salon');
  const level = await exportedLevel(page);
  expect(level).toEqual(moved);
  const [salon, bureau] = ['Salon', 'Bureau'].map((name) =>
    level.rooms.find((r) => r.name === name),
  );
  // 4 × 3 m clear, 0.10 m partition moved 0.3 m into Bureau.
  expect(area(salon!.polygon)).toBeCloseTo(7, 6);
  expect(area(bureau!.polygon)).toBeCloseTo(4.6, 6);
  const door = partition(level).openings![0];
  expect(door).toMatchObject({ kind: 'door', offset: 1.65, width: 0.9, swing: 1 });

  await page.getByRole('button', { name: 'Visite', exact: true }).click();
  const viewport = page.locator('#viewport');
  await expect(viewport).toHaveAttribute('data-walk-room', salon!.id);
  await page.locator('#scene').focus();
  await page.keyboard.press('KeyE');
  await page.keyboard.down('KeyW');
  await expect(viewport).toHaveAttribute('data-walk-room', bureau!.id, { timeout: 15_000 });
  await page.keyboard.up('KeyW');
});
