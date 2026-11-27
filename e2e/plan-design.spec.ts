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

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await startupDone(page);
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

test('design two rooms in Plan, then walk through their door in Visite', async ({ page }) => {
  // A drawing, several drags, a reload and a software-rendered walk on CI.
  test.slow();
  const [x0, z0] = await drawClearRoom(page);
  await expect(page.locator('#plan-edit-bar')).toBeVisible();
  const first = await exportedLevel(page);
  expect(first.rooms.map((r) => area(r.polygon))).toEqual([expect.closeTo(12, 6)]);

  // The start faces +z (yaw 0): a partition across the depth puts the door straight ahead.
  // Its axis 1.9 m from the top axis leaves 1.75 m on the start side, 1.15 m beyond. It starts
  // on the right wall (« Premiers pas » may cover the left one) and its length is typed.
  const [x, y] = await pagePoint(page, [x0 + 4.2, z0 + 1.9]);
  await page.mouse.click(x, y);
  await page.keyboard.type('4.2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#wall-draft .wall-draft-joint')).toHaveCount(6);
  const divided = await exportedLevel(page);
  expect(partition(divided).start[1]).toBeCloseTo(z0 + 1.9, 6);
  expect(divided.rooms.map((r) => area(r.polygon))).toEqual([
    expect.closeTo(7, 6),
    expect.closeTo(4.6, 6),
  ]);

  // Page points are read from the wall tool's corners before « Porte » turns it off.
  const [doorClick, doorTarget, onPartitionBefore, onPartition, tooNarrow, inStart, onDoor] =
    await Promise.all(
      (
        [
          [x0 + 3, z0 + 1.9],
          [x0 + 2.1, z0 + 1.9],
          [x0 + 3.5, z0 + 1.9],
          [x0 + 3.5, z0 + 2.1],
          [x0 + 3.5, z0 + 2.9],
          [x0 + 3.5, z0 + 1],
          [x0 + 2.1, z0 + 2.1],
        ] as Point[]
      ).map((p) => pagePoint(page, p)),
    );
  const inspector = page.locator('#plan-inspector');
  const layer = page.locator('#plan-selection');

  // A door placed by click, centred 1.2 m along the partition, then dragged to 1.65 m.
  await page.locator('#place-door').click();
  await expect(page.locator('#wall-hint')).toBeHidden();
  await page.mouse.click(...doorClick);
  await expect(inspector.getByLabel('Largeur')).toHaveValue('0.9');
  await expect(inspector.getByLabel('Distance au jambage')).toHaveValue('0.75');
  await page.mouse.move(...doorClick);
  await page.mouse.down();
  await page.mouse.move(...doorTarget, { steps: 8 });
  await expect(page.locator('#plan-drag-distances')).toHaveText('1,65 m · 1,65 m');
  await page.mouse.up();
  await expect(inspector.getByLabel('Distance au jambage')).toHaveValue('1.65');
  expect(partition(await exportedLevel(page)).openings![0]).toMatchObject({
    kind: 'door',
    offset: 1.65,
    width: 0.9,
    swing: 1,
  });

  // Select the partition, then drag it 0.20 m away from the start: the 5 cm grid keeps it exact.
  await page.mouse.click(...onPartitionBefore);
  await expect(inspector.getByLabel('Épaisseur')).toHaveValue('0.1');
  await page.mouse.move(...onPartitionBefore);
  await page.mouse.down();
  await page.mouse.move(...onPartition, { steps: 8 });
  await expect(layer).toHaveAttribute('data-drag-state', 'valid');
  await expect(layer.locator('.plan-drag-area')).toHaveCount(2);
  console.log(
    `Partition drag, pointer to preview: ${await layer.getAttribute('data-preview-latency-ms')} ms`,
  );
  await page.mouse.up();
  const moved = await exportedLevel(page);
  expect(partition(moved).start[1]).toBeCloseTo(z0 + 2.1, 6);
  expect(partition(moved).openings![0].offset).toBeCloseTo(1.65, 6);

  await page.getByRole('button', { name: 'Annuler la modification du plan' }).click();
  expect(partition(await exportedLevel(page)).start[1]).toBeCloseTo(z0 + 1.9, 6);
  await page.getByRole('button', { name: 'Rétablir la modification du plan' }).click();
  expect(await exportedLevel(page)).toEqual(moved);

  // Too close to the far wall to walk: red while dragging, back to the last house on release.
  await page.mouse.move(...onPartition);
  await page.mouse.down();
  await page.mouse.move(...tooNarrow, { steps: 8 });
  await expect(layer).toHaveAttribute('data-drag-state', 'invalid');
  await expect(page.locator('#plan-drag-message')).not.toBeEmpty();
  await page.mouse.up();
  expect(await exportedLevel(page)).toEqual(moved);

  await page.mouse.click(...onPartition);
  await expect(inspector.getByLabel('Épaisseur')).toHaveValue('0.1');
  await inspector.getByLabel('Épaisseur').fill('0.15');
  await inspector.getByLabel('Épaisseur').press('Enter');
  const thicker = await exportedLevel(page);
  expect(thicker.rooms.map((r) => area(r.polygon))).toEqual([
    expect.closeTo(7.7, 6),
    expect.closeTo(3.7, 6),
  ]);
  await page.locator('#scene').focus();
  await page.keyboard.press('Control+z');
  await expect(inspector.getByLabel('Épaisseur')).toHaveValue('0.1');
  expect(await exportedLevel(page)).toEqual(moved);

  await page.mouse.click(...onDoor);
  await inspector.getByLabel('Largeur').fill('5');
  await inspector.getByLabel('Largeur').press('Enter');
  await expect(inspector.getByRole('alert')).toHaveText('L’ouverture dépasse le bout du mur.');
  expect(await exportedLevel(page)).toEqual(moved);

  await page.mouse.click(...inStart);
  // A lost click once hung here until the test timeout (#374): fail fast, naming what is shown.
  await expect(inspector.getByRole('heading')).toHaveText('Pièce');
  await inspector.getByLabel('Nom').fill('Entrée');
  await inspector.getByLabel('Nom').press('Enter');
  await expect(page.locator('#scene-labels')).toContainText('Entrée');
  const renamed = await exportedLevel(page);
  expect(renamed.rooms[0].name).toBe('Entrée');

  // A window dragged onto the door turns red and goes back to where it was placed.
  await page.locator('#place-window').click();
  await page.mouse.click(...onPartition);
  await expect(inspector.getByLabel('Hauteur d’allège')).toHaveValue('0.9');
  const windowed = await exportedLevel(page);
  await page.mouse.move(...onPartition);
  await page.mouse.down();
  await page.mouse.move(...onDoor, { steps: 8 });
  await expect(layer).toHaveAttribute('data-drag-state', 'invalid');
  await expect(page.locator('#plan-drag-message')).toHaveText(
    'L’ouverture chevauche une autre ouverture.',
  );
  await page.mouse.up();
  expect(await exportedLevel(page)).toEqual(windowed);

  await page.reload();
  await startupDone(page);
  await expect(page.locator('#header-project')).toHaveText('Nouvelle maison');
  await expect(page.locator('#room-list')).toContainText('Entrée');
  const level = await exportedLevel(page);
  expect(level).toEqual(windowed);
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

test('every Plan click selects, however quick or long it is', async ({ page }) => {
  const [x0, z0] = await drawClearRoom(page);
  const [onWall, inRoom] = await Promise.all(
    (
      [
        [x0 + 2, z0],
        [x0 + 1, z0 + 1],
      ] as Point[]
    ).map((p) => pagePoint(page, p)),
  );
  await page.locator('#wall-tool').click();
  const heading = page.locator('#plan-inspector').getByRole('heading');

  // Quick clicks, some within Babylon's double-click delay (#374).
  for (const at of [onWall, inRoom, onWall, inRoom]) await page.mouse.click(...at);
  await expect(heading).toHaveText('Pièce');

  // A press longer than Babylon's long-press delay.
  await page.mouse.move(...onWall);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(heading).toHaveText('Mur extérieur');
});
