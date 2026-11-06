import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFurniture, type FurnitureItem } from '../src/furniture/model';
import { furnitureDistances } from '../src/furniture/checks';
import type { Level } from '../src/model/types';

async function furnishings(page: Page) {
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.getByRole('tab', { name: /Meubles/ }).click();
}
async function closePanel(page: Page) {
  if ((await page.locator('#toggle-sidebar').getAttribute('aria-expanded')) === 'true')
    await page.locator('#toggle-sidebar').click();
}
async function importItems(page: Page, items: FurnitureItem[]) {
  const demo = JSON.parse(await readFile('public/projects/studio-demo.json', 'utf8'));
  const level: Level = {
    id: 'actions-level',
    name: 'Pièce test',
    elevation: 0,
    ceilingHeight: 3,
    outline: [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
    walls: [],
    lights: [],
    rooms: [
      {
        id: 'room',
        name: 'Repère test',
        kind: 'living',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
        label: [4, 3],
        viewpoint: [4, 3],
      },
    ],
    spawn: { position: [5, 4], yaw: 0 },
  };
  const project = {
    ...demo,
    id: 'actions-test',
    name: 'Test meubles',
    levels: [level],
    furnishing: { version: 1, levels: { [level.id]: items } },
  };
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#import-file').setInputFiles({
    name: 'actions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('#project-select option:checked')).toHaveText('Test meubles');
  await furnishings(page);
  return level;
}
async function exportedItems(page: Page) {
  const event = page.waitForEvent('download');
  await page.locator('#export-project').click();
  const download = await event;
  const path = await download.path();
  const project = JSON.parse(await readFile(path!, 'utf8'));
  return project.furnishing.levels['actions-level'] as FurnitureItem[];
}
test.beforeEach(async ({ page }) => {
  if (process.env.MYBOB_E2E_SLOW_CPU === '1') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  // Avoid sampling a room label halfway through the sidebar transition.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4179(?:\/|$))/, (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

test('huit chaises, copie indépendante et historique sans interception des champs', async ({
  page,
}, info) => {
  test.slow();
  await importItems(page, [
    createFurniture({ id: 'table', name: 'Table test', kind: 'table', position: [4, 3] }),
  ]);
  await page.locator('[data-furniture-select]').click();
  await closePanel(page);
  await page
    .getByRole('button', { name: 'Ajouter des chaises autour de la table', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Chaises autour de la table', exact: true });
  await expect(dialog.getByLabel('Nombre de chaises')).toHaveValue('8');
  await page.screenshot({ path: info.outputPath('chair-options.png') });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Ajouter des chaises autour de la table', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Ajouter les chaises', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(9);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.screenshot({ path: info.outputPath('eight-chairs.png') });
  await furnishings(page);
  await page.locator('[data-furniture-select]').filter({ hasText: 'Chaise 1' }).click();
  await closePanel(page);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(10);
  const items = await exportedItems(page);
  const copy = items.find((item) => item.name === 'Chaise 1 (copie)')!;
  expect(copy).toBeTruthy();
  expect(copy.groupId).toBeUndefined();
  expect(new Set(items.map((item) => item.id)).size).toBe(10);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(9);
  await furnishings(page);
  await page.getByRole('button', { name: 'Modifier Chaise 1', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Modifier Chaise 1', exact: true });
  await editor.getByLabel('Nom', { exact: true }).fill('Brouillon');
  await editor
    .getByLabel('Nom', { exact: true })
    .dispatchEvent('keydown', { code: 'KeyC', key: 'c', ctrlKey: true, bubbles: true });
  await editor
    .getByLabel('Nom', { exact: true })
    .dispatchEvent('keydown', { code: 'KeyV', key: 'v', ctrlKey: true, bubbles: true });
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(9);
  await editor.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(
    page.getByRole('button', { name: 'Modifier Chaise 1 (copie)', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
});

test('liaison meuble TV et TV enregistrée conserve le groupe au glisser, au clavier et au rechargement', async ({
  page,
}, info) => {
  test.slow();
  await importItems(page, [
    createFurniture({ id: 'stand', kind: 'tv-stand', name: 'Meuble TV test', position: [4, 3] }),
    createFurniture({ id: 'tv', kind: 'tv', name: 'TV test', position: [4, 3], elevation: 0.55 }),
  ]);
  await page.getByRole('button', { name: 'Modifier Meuble TV test', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Modifier Meuble TV test', exact: true });
  await editor.getByText('Lier à un autre meuble', { exact: true }).click();
  await editor.getByLabel('Meuble à ajouter').selectOption('tv');
  await editor.getByRole('button', { name: 'Ajouter à l’ensemble', exact: true }).click();
  await expect(editor.locator('.furniture-group-members li')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('group-editor.png') });
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await closePanel(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('group', { name: 'Actions du meuble sélectionné', exact: true }),
  ).not.toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const label = page.locator('[data-label]').filter({ hasText: 'Repère test' });
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  await page.locator('#tool-labels').click();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 45, box!.y + box!.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  let items = await exportedItems(page);
  const stand = items.find((item) => item.id === 'stand')!,
    tv = items.find((item) => item.id === 'tv')!;
  expect(stand.position).not.toEqual([4, 3]);
  expect(tv.position[0]).toBeCloseTo(stand.position[0], 8);
  expect(tv.position[1]).toBeCloseTo(stand.position[1], 8);
  expect(tv.groupId).toBe(stand.groupId);
  expect(stand.groupId).toBeTruthy();
  await furnishings(page);
  await page.locator('[data-furniture-select]').filter({ hasText: 'Meuble TV test' }).click();
  await closePanel(page);
  await page.locator('#scene').focus();
  await page.keyboard.press('ArrowLeft');
  items = await exportedItems(page);
  expect(items[0].position[0]).toBeCloseTo(items[1].position[0], 8);
  expect(items[0].position[1]).toBeCloseTo(items[1].position[1], 8);
  expect(items[0].position).not.toEqual(stand.position);
  await page.reload();
  await furnishings(page);
  await page.getByRole('button', { name: 'Modifier Meuble TV test', exact: true }).click();
  await expect(editor.locator('.furniture-group-members li')).toHaveCount(2);
});

test('la table se déplace dans le creux du canapé avec la souris et les flèches et sa distance varie', async ({
  page,
}, info) => {
  test.slow();
  const sofa = createFurniture({
    id: 'sofa',
    kind: 'sofa',
    name: 'Canapé test',
    width: 3,
    depth: 3,
    position: [4, 3],
    sofa: { shape: 'corner', side: 'left', seatDepth: 0.6, returnWidth: 0.6 },
  });
  const table = createFurniture({
    id: 'table',
    kind: 'coffee-table',
    name: 'Table test',
    width: 1,
    depth: 0.5,
    position: [4.2, 3],
  });
  const level = await importItems(page, [sofa, table]);
  const distance = (items: FurnitureItem[]) =>
    furnitureDistances(
      items.find((item) => item.id === 'table')!,
      level,
      items,
    ).find((value) => value.label === 'À gauche')!.distance;
  expect(distance([sofa, table])).toBeCloseTo(0.6, 6);
  await closePanel(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const label = page.locator('[data-label]').filter({ hasText: 'Repère test' });
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  expect(box).not.toBeNull();
  await page.locator('#tool-labels').click();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator('[data-furniture-select="table"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.mouse.move(x - 5, y, { steps: 6 });
  await page.mouse.up();
  let items = await exportedItems(page);
  expect(items.find((item) => item.id === 'table')!.position[0]).toBeLessThan(table.position[0]);
  expect(distance(items)).toBeLessThan(0.6);
  expect(items.find((item) => item.id === 'sofa')).toEqual(sofa);
  const previous = distance(items);
  await furnishings(page);
  await page.locator('[data-furniture-select]').filter({ hasText: 'Table test' }).click();
  await page.keyboard.press('ArrowLeft');
  items = await exportedItems(page);
  expect(distance(items)).toBeLessThan(previous);
  await closePanel(page);
  await page.screenshot({ path: info.outputPath('table-inside-sofa.png') });
});
