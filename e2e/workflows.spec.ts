import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFurniture } from '../src/furniture/model';

// Only exercise the compiled public demo through its UI; each test gets fresh storage.
test('agrandir un canapé contre un mur conserve le bord bloqué et reste annulable', async ({
  page,
}, testInfo) => {
  test.slow();
  const demo = JSON.parse(await readFile('public/projects/studio-demo.json', 'utf8'));
  const level = {
    id: 'resize-level',
    name: 'Pièce test',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls: [{ id: 'wall', start: [0.1, 0], end: [0.1, 6], thickness: 0.2 }],
    rooms: [
      {
        id: 'room',
        name: 'Pièce test',
        kind: 'living',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        label: [4, 3],
        viewpoint: [4, 3],
      },
    ],
    lights: [],
    spawn: { position: [4, 3], yaw: 0 },
  };
  const sofa = createFurniture({
    id: 'resize-sofa',
    kind: 'sofa',
    name: 'Canapé au mur',
    width: 2,
    depth: 1,
    position: [1.2, 3],
  });
  const project = {
    ...demo,
    id: 'resize-demo',
    name: 'Test redimensionnement',
    levels: [level],
    furnishing: { version: 1, levels: { [level.id]: [sofa] } },
  };
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#import-file').setInputFiles({
    name: 'resize-demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('#project-select option:checked')).toHaveText('Test redimensionnement');
  await furnishings(page);
  const edit = page.getByRole('button', { name: 'Modifier Canapé au mur', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Modifier Canapé au mur', exact: true });
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('300');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await edit.click();
  await expect(dialog.getByLabel(/Largeur/).first()).toHaveValue('200');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('300');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await furnishings(page);
  await edit.click();
  await expect(dialog.getByLabel(/Largeur/).first()).toHaveValue('300');
  await dialog.getByText('Placement et options', { exact: true }).click();
  const x = Number(await dialog.locator('[name=x]').inputValue());
  expect(x).toBeGreaterThan(169);
  expect(x).toBeLessThanOrEqual(170.1);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('resized-sofa.png') });
  await page.keyboard.press('ControlOrMeta+z');
  await edit.click();
  await expect(dialog.getByLabel(/Largeur/).first()).toHaveValue('200');
});

async function furnishings(page: Page) {
  const menu = page.locator('#toggle-sidebar');
  if (await menu.isVisible()) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  }
  await page.getByRole('tab', { name: /Meubles/ }).click();
}

async function addSofa(page: Page) {
  await furnishings(page);
  await page.getByRole('button', { name: 'Ajouter un meuble', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Canapé E2E');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('210');
  await dialog.getByRole('button', { name: 'Ajouter dans la maison' }).click();
  await expect(dialog).not.toBeVisible();
  await furnishings(page);
  await expect(
    page.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // External optional fonts must not make the suite depend on internet access.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Plan', exact: true })).toBeEnabled();
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

test('ajout, brouillon annulé et rechargement conservent les valeurs enregistrées', async ({
  page,
}) => {
  await addSofa(page);
  await page.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier Canapé E2E', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Brouillon à jeter');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('250');
  await dialog.getByRole('button', { name: 'Dupliquer', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.reload();
  await furnishings(page);
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }).click();
  await expect(dialog.getByLabel('Nom', { exact: true })).toHaveValue('Canapé E2E');
  await expect(dialog.getByLabel(/Largeur/).first()).toHaveValue('210');
});

async function emptyVariant(page: Page) {
  await addSofa(page);
  const variants = page.getByRole('region', { name: 'Variantes d’aménagement', exact: true });
  await variants.getByRole('button', { name: 'Dupliquer', exact: true }).click();
  await variants.getByLabel('Nom de la copie').fill('Option E2E');
  await variants.getByRole('button', { name: 'Créer la copie' }).click();
  await page.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier Canapé E2E', exact: true });
  await dialog.getByRole('button', { name: 'Retirer le meuble' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await furnishings(page);
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(0);
}

test('variantes indépendantes, annuler/rétablir et confirmation du nom inchangé', async ({
  page,
}) => {
  await emptyVariant(page);
  await page.getByRole('button', { name: 'Annuler la dernière modification', exact: true }).click();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  const select = page.getByLabel('Variante d’aménagement', { exact: true });
  await select.selectOption({ label: 'Aménagement initial' });
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await select.selectOption({ label: 'Option E2E' });
  await page.getByRole('button', { name: 'Rétablir la modification', exact: true }).click();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(0);
  const variants = page.getByRole('region', { name: 'Variantes d’aménagement', exact: true });
  await variants.getByRole('button', { name: 'Renommer' }).click();
  await variants.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(variants.getByLabel('Nom de la variante')).toHaveCount(0);
  await page.reload();
  await furnishings(page);
  await expect(select.locator('option:checked')).toHaveText('Option E2E');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(0);
  await variants.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await variants.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(select.locator('option')).toHaveCount(2);
  await variants.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await variants.getByRole('button', { name: 'Confirmer la suppression' }).click();
  await expect(select.locator('option:checked')).toHaveText('Aménagement initial');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await expect(variants.getByRole('button', { name: 'Supprimer', exact: true })).toBeDisabled();
  await page.reload();
  await furnishings(page);
  await expect(select.locator('option')).toHaveCount(1);
});

test('export JSON puis import dans un navigateur vierge restaurent toutes les variantes', async ({
  page,
  browser,
}, testInfo) => {
  // This journey loads two separate WebGL sessions; software rendering on CI is slower.
  test.slow();
  await emptyVariant(page);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-project').click();
  const download = await downloadEvent;
  const file = testInfo.outputPath('demo-export.json');
  await download.saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  const variants = exported.furnishing.variants.variants;
  expect(variants).toHaveLength(2);
  const count = (name: string) =>
    Object.values(variants.find((v: { name: string }) => v.name === name).levels).flat().length;
  expect(count('Aménagement initial')).toBe(1);
  expect(count('Option E2E')).toBe(0);
  await page.close();

  // A second isolated context proves import restores the file, rather than old localStorage.
  const context = await browser.newContext(testInfo.project.use);
  try {
    const imported = await context.newPage();
    await imported.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    await imported.goto('/');
    await furnishings(imported);
    await imported.getByRole('tab', { name: 'Maison', exact: true }).click();
    await imported.locator('#import-file').setInputFiles(file);
    await imported.getByRole('button', { name: /Remplacer/, exact: false }).click();
    await furnishings(imported);
    const select = imported.getByLabel('Variante d’aménagement', { exact: true });
    await expect(select.locator('option:checked')).toHaveText('Option E2E');
    await expect(imported.locator('[data-furniture-edit-id]')).toHaveCount(0);
    await select.selectOption({ label: 'Aménagement initial' });
    await expect(
      imported.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }),
    ).toBeVisible();
    await imported.reload();
    await furnishings(imported);
    await expect(
      imported.getByRole('button', { name: 'Modifier Canapé E2E', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Plan, export PNG et outils sur écran bas restent utilisables', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Exporter une image de la vue', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger le PNG', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = testInfo.outputPath('plan.png');
  await download.saveAs(file);
  const png = await readFile(file);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  await page.setViewportSize({ width: 568, height: 320 });
  await page.getByTitle('Recentrer la vue', { exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Vue recentrée');
  const reset = await page.getByTitle('Recentrer la vue', { exact: true }).boundingBox();
  expect(reset).not.toBeNull();
  expect(reset!.y).toBeGreaterThanOrEqual(0);
  expect(reset!.y + reset!.height).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});

test('actions rapides et Ctrl Z fonctionnent sans popup et sans sélection active', async ({
  page,
}, testInfo) => {
  test.slow();
  await addSofa(page);
  const closePanel = async () => {
    const menu = page.locator('#toggle-sidebar');
    if ((await menu.getAttribute('aria-expanded')) === 'true') await menu.click();
  };
  await closePanel();
  const toolbar = page.getByRole('group', { name: 'Actions du meuble sélectionné', exact: true });
  await expect(toolbar).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('quick-actions.png') });
  await toolbar
    .getByRole('button', { name: 'Dupliquer le meuble sélectionné', exact: true })
    .click();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Suppr works while Duplicate keeps focus; no scene click is required.
  await expect(
    toolbar.getByRole('button', { name: 'Dupliquer le meuble sélectionné', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  // French AZERTY sends logical z on physical KeyW, not KeyZ.
  await page
    .locator('body')
    .dispatchEvent('keydown', { key: 'z', code: 'KeyW', ctrlKey: true, bubbles: true });
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(2);
  await page
    .locator('body')
    .dispatchEvent('keydown', { key: 'z', code: 'KeyW', ctrlKey: true, bubbles: true });
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await expect(toolbar).not.toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await furnishings(page);
  await page.locator('[data-furniture-select]').click();
  await closePanel();
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Retirer le meuble sélectionné', exact: true }).click();
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
  await furnishings(page);
  await page.locator('[data-furniture-select]').click();
  await closePanel();
  await page.keyboard.press('Escape');
  await expect(toolbar).not.toBeVisible();
  await furnishings(page);
  await page.locator('[data-furniture-select]').click();
  await closePanel();
  await expect(toolbar).toBeVisible();
  await page.locator('#scene').click({ position: { x: 10, y: 180 } });
  await expect(toolbar).not.toBeVisible();
});

test('mesure avec aperçu, alignement droit et validation au second clic', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  const label = page.locator('[data-label]').filter({ hasText: 'Espace de vie' });
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  expect(box).not.toBeNull();
  await page.locator('#tool-labels').click();
  await page.getByTitle('Mesurer une distance au sol', { exact: true }).click();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.click(x, y);
  await expect(page.locator('#measure-instructions')).toContainText('Déplacez le pointeur');
  await page.mouse.move(x + 35, y + 1, { steps: 3 });
  await expect(page.locator('#measure-label')).toBeVisible();
  await expect(page.locator('#measure-label')).toContainText('droit');
  await page.screenshot({ path: testInfo.outputPath('measurement-preview.png') });
  const first = await page.locator('#measure-label').textContent();
  await page.mouse.move(x + 60, y + 1, { steps: 3 });
  await expect(page.locator('#measure-label')).not.toHaveText(first!);
  await page.mouse.click(x + 60, y + 1);
  await expect(page.locator('#measure-instructions')).toContainText('Un nouveau clic');
  const final = await page.locator('#measure-label').textContent();
  await page.mouse.move(x - 20, y + 25);
  await expect(page.locator('#measure-label')).toHaveText(final!);
  await page.keyboard.press('Escape');
  await expect(page.locator('#measure-label')).not.toBeVisible();
});
test('MyBob accueille et présente les commandes sans masquer le projet', async ({
  page,
}, testInfo) => {
  await expect(page).toHaveTitle(/MyBob/);
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await expect(page.getByText('Bonjour, moi c’est Bob.')).toBeVisible();
  await expect(page.locator('.bob-welcome img')).toHaveJSProperty('naturalWidth', 384);
  await expect(page.getByRole('button', { name: 'Importer ma maison' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mybob-projet.png') });
  if ((await menu.getAttribute('aria-expanded')) === 'true' && (await menu.isVisible()))
    await menu.click();
  await page.getByRole('button', { name: 'Aide et commandes' }).click();
  const dialog = page.getByRole('dialog', { name: 'PRENDRE EN MAIN L’ATELIER' });
  await expect(dialog.getByText(/Moi, c’est Bob/)).toBeVisible();
  await expect(dialog.locator('.first-steps-list li')).toHaveCount(3);
  await dialog.getByRole('button', { name: /Tout voir/ }).click();
  await expect(dialog.getByText('Vue 3D', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mybob-aide.png') });
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).not.toBeVisible();
});

test('la visite recapture le pointeur après sa libération, clic dans la vue compris', async ({
  page,
}) => {
  const locked = () => page.evaluate(() => document.pointerLockElement !== null);
  // Le Chromium headless ignore la sortie au clavier de la capture : le test
  // libère le pointeur par l'API DOM que déclenche aussi Échap, et l'app
  // doit rebinder dans les deux chemins de reprise.
  await page.getByRole('button', { name: 'Entrer dans la visite' }).click();
  await page.locator('#capture-mouse').click();
  await expect.poll(locked).toBe(true);
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(locked).toBe(false);
  // Un clic dans la vue reprend la capture — rien ne se passait auparavant.
  await page.locator('#scene').click({ position: { x: 640, y: 360 } });
  await expect.poll(locked, { timeout: 5_000 }).toBe(true);
  // Le bouton « Reprendre la visite » rebinde aussi un second aller-retour.
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(locked).toBe(false);
  await page.locator('#resume-walk').click();
  await expect.poll(locked, { timeout: 5_000 }).toBe(true);
});
