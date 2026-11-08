import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFurniture } from '../src/furniture/model';

// The link carries the project state: check the emission (#p1:), the recipient's
// read-only state, adoption, silence for the owner and the divergence of an old link.
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Plan', exact: true })).toBeEnabled();
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});

async function furnishings(page: Page) {
  const menu = page.locator('#toggle-sidebar');
  if (await menu.isVisible()) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  }
  await page.getByRole('tab', { name: /Meubles/ }).click();
}

async function importLinkProject(page: Page, options: { upperLevel?: boolean } = {}) {
  const demo = JSON.parse(await readFile('public/projects/studio-demo.json', 'utf8'));
  const level = {
    id: 'lien-niveau',
    name: 'Pièce du lien',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls: [{ id: 'lien-mur', start: [0.1, 0], end: [0.1, 6], thickness: 0.2 }],
    rooms: [
      {
        id: 'lien-piece',
        name: 'Pièce du lien',
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
  // Second level with the same outline: identifiers are unique across all levels.
  const upper = {
    ...structuredClone(level),
    id: 'lien-etage',
    name: 'Étage du lien',
    elevation: 2.7,
    walls: level.walls.map((wall) => ({ ...wall, id: `${wall.id}-etage` })),
    rooms: level.rooms.map((room) => ({ ...room, id: `${room.id}-etage` })),
  };
  const sofa = createFurniture({
    id: 'lien-canape',
    kind: 'sofa',
    name: 'Canapé lien',
    width: 2,
    depth: 1,
    position: [2, 3],
  });
  const project = {
    ...demo,
    id: 'lien-partage-demo',
    name: 'Maison du lien',
    levels: options.upperLevel ? [level, upper] : [level],
    furnishing: { version: 1, levels: { [level.id]: [sofa] } },
  };
  const menu = page.locator('#toggle-sidebar');
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#import-file').setInputFiles({
    name: 'lien-partage-demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('#project-select option:checked')).toHaveText('Maison du lien');
}

/**
 * Copies the current state's link. The hash already contains `#p1:` before the import — the
 * demonstration's — so its mere presence proves nothing: `copyShareLink` writes the hash then
 * shows its toast, and that toast guarantees that `page.url()` does describe the expected state.
 */
async function sharedHash(page: Page) {
  await page.locator('#copy-link').click();
  await expect(page.locator('#toast')).toContainText(/copi/i);
  await expect.poll(() => new URL(page.url()).hash).toContain('#p1:');
  return page.url();
}

test('a shared link opens read-only, then editable after adding it', async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  await importLinkProject(page);
  const shared = await sharedHash(page);
  await page.close();

  // A recipient without local memory opens the link: banner, mutation refused.
  const context = await browser.newContext(testInfo.project.use);
  try {
    const received = await context.newPage();
    await received.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    await received.goto(shared);
    const banner = received.locator('#received-banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('Projet reçu');
    await furnishings(received);
    await expect(received.locator('#project-select')).toContainText('Maison du lien');
    await received.getByRole('button', { name: 'Modifier Canapé lien', exact: true }).click();
    await expect(received.locator('#toast')).toContainText('lecture seule');
    await expect(received.getByRole('dialog', { name: 'Modifier Canapé lien' })).toHaveCount(0);
    await expect(received.locator('[data-furniture-edit-id]')).toHaveCount(1);

    // « Ajouter à mes projets »: copy under a new identifier, now editable.
    await banner.getByRole('button', { name: 'Ajouter à mes projets' }).click();
    await expect(received.locator('#toast')).toContainText('vos projets');
    await expect(banner).toBeHidden();
    await received.reload();
    await furnishings(received);
    await expect(banner).toBeHidden();
    await expect(
      received.getByRole('button', { name: 'Modifier Canapé lien', exact: true }),
    ).toBeVisible();
    // The owned project also rewrites the hash, without banner nor dialog.
    const owned = await sharedHash(received);
    expect(new URL(owned).hash).toContain('#p1:');
  } finally {
    await context.close();
  }
});

test('changing level keeps the project received by link, without going back to the demonstration', async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  await importLinkProject(page, { upperLevel: true });
  const shared = await sharedHash(page);
  await page.close();

  const context = await browser.newContext(testInfo.project.use);
  try {
    const received = await context.newPage();
    await received.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    await received.goto(shared);
    const banner = received.locator('#received-banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(received.locator('#project-select option:checked')).toHaveText(
      'Maison du lien — reçu',
    );

    // The pack renumbers level identifiers: the label, however, is kept.
    await received.locator('#level-select').selectOption({ label: 'Étage du lien' });

    // The received project is not in the project list: reloading it by its
    // identifier fell back to the demonstration.
    await expect(received.locator('#header-level')).toHaveText('Étage du lien');
    await expect(received.locator('#project-select option:checked')).toHaveText(
      'Maison du lien — reçu',
    );
    await expect(banner).toBeVisible();
    await expect(received.locator('#demo-notice')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('the owner reloading their own link sees no dialog', async ({ page }) => {
  await importLinkProject(page);
  const shared = await sharedHash(page);
  await page.reload();
  await expect(page.locator('#received-banner')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#project-select option:checked')).toHaveText('Maison du lien');
  await furnishings(page);
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
});

test('a link older than the local state offers to keep both', async ({ page }) => {
  await importLinkProject(page);
  const before = await page.locator('#project-select option').count();
  const older = await sharedHash(page);
  // A change after emission makes the link divergent.
  await furnishings(page);
  await page.getByRole('button', { name: 'Ajouter un meuble', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Fauteuil lien');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('90');
  await dialog.getByRole('button', { name: 'Ajouter dans la maison' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).not.toBe(new URL(older).hash);

  await page.goto(older);
  await page.reload();
  const divergence = page.getByText('diffèrent', { exact: false });
  await expect(divergence).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Garder les deux' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Adoption is asynchronous: counting before it has installed the copy would
  // suggest that the reload adds a project.
  await expect(page.locator('#toast')).toContainText('vos projets');
  await expect(page.locator('#project-select option')).toHaveCount(before + 1);
  await page.reload();
  await expect(page.locator('#project-select option')).toHaveCount(before + 1);
  await expect(page.locator('#received-banner')).toBeHidden();
});

test('at 10 projects, « Garder les deux » offers to replace a project from the link, no fatal screen', async ({
  page,
}) => {
  // Three openings of the link, each with its WebGL session: leave headroom for the runner.
  test.slow();
  // Nine projects already kept, the tenth is the link's.
  const demo = JSON.parse(await readFile('public/projects/studio-demo.json', 'utf8'));
  await page.evaluate((base) => {
    const others = Array.from({ length: 9 }, (_, i) => ({
      ...base,
      id: `remplissage-${i}`,
      name: `Remplissage ${i}`,
    }));
    localStorage.setItem('maison-atelier:projects:v1', JSON.stringify(others));
  }, demo);
  await page.reload();
  await expect(page.locator('#project-select')).toContainText('Remplissage 8');
  await importLinkProject(page);
  const older = await sharedHash(page);
  await furnishings(page);
  await page.getByRole('button', { name: 'Ajouter un meuble', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Fauteuil limite');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('90');
  await dialog.getByRole('button', { name: 'Ajouter dans la maison' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).not.toBe(new URL(older).hash);

  // Each opening of the link happens in a new tab: a tab that wrote the hash of
  // its state recognises its own link on reload and then shows no dialog.
  const context = page.context();
  await page.close();
  const first = await context.newPage();
  await first.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await first.goto(older);
  await expect(first.getByText('diffèrent', { exact: false })).toBeVisible({ timeout: 20_000 });
  const total = await first.locator('#project-select option').count();
  await first.getByRole('button', { name: 'Garder les deux' }).click();
  const limit = first.getByRole('dialog', { name: /Limite de 10 projets/ });
  await expect(limit).toBeVisible();
  await expect(first.locator('#fatal-error')).toBeHidden();

  // Annuler deletes and adds nothing.
  await limit.getByRole('button', { name: 'Annuler' }).click();
  await expect(first.getByRole('dialog')).toHaveCount(0);
  await expect(first.locator('#project-select option')).toHaveCount(total);

  // Replace: the copy is added, the chosen project disappears, the total stays at 10 imported.
  await first.close();
  const reopened = await context.newPage();
  await reopened.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await reopened.goto(older);
  await expect(reopened.getByText('diffèrent', { exact: false })).toBeVisible({ timeout: 20_000 });
  await reopened.getByRole('button', { name: 'Garder les deux' }).click();
  await reopened.getByLabel('Projet à remplacer').selectOption({ label: 'Remplissage 0' });
  await reopened.getByRole('button', { name: 'Remplacer ce projet' }).click();
  await expect(reopened.locator('#toast')).toContainText('vos projets');
  await expect(reopened.locator('#fatal-error')).toBeHidden();
  await expect(reopened.locator('#project-select option')).toHaveCount(total);
  await expect(reopened.locator('#project-select')).not.toContainText('Remplissage 0');
  await expect(reopened.locator('#project-select')).toContainText('Remplissage 8');
});

test('a refused URL publication does not turn the reload into a received link', async ({
  page,
}) => {
  // The application remembers in session the last hash it published. If it were remembered
  // before `history.replaceState`, a refused publication would leave that memory ahead
  // of the URL: on reload, the tab would take its own stale hash for a received link
  // and stay stuck behind the divergence dialog.
  await page.evaluate(() => {
    const state = window as unknown as { refuseShareHash: boolean; refusedHashWrites: number };
    const replaceState = History.prototype.replaceState;
    state.refuseShareHash = false;
    state.refusedHashWrites = 0;
    History.prototype.replaceState = function (data, unused, url) {
      if (state.refuseShareHash && String(url ?? '').startsWith('#p1:')) {
        state.refusedHashWrites += 1;
        throw new DOMException('Publication refusée pour le test.', 'SecurityError');
      }
      return replaceState.call(this, data, unused, url);
    };
  });
  await importLinkProject(page);
  const older = await sharedHash(page);
  await page.evaluate(() => {
    (window as unknown as { refuseShareHash: boolean }).refuseShareHash = true;
  });
  // The change can no longer reach the URL: it only lives in local storage.
  await furnishings(page);
  await page.getByRole('button', { name: 'Ajouter un meuble', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Fauteuil refusé');
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('90');
  await dialog.getByRole('button', { name: 'Ajouter dans la maison' }).click();
  await expect(dialog).not.toBeVisible();
  // The write was indeed attempted and refused before the reload.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { refusedHashWrites: number }).refusedHashWrites),
    )
    .toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('diffèrent', { exact: false })).toHaveCount(0);
  await expect(page.locator('#received-banner')).toBeHidden();
  await furnishings(page);
  // The local state, more recent than the URL, stays the reference on reload.
  await expect(
    page.getByRole('button', { name: 'Modifier Fauteuil refusé', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).hash, { timeout: 20_000 })
    .not.toBe(new URL(older).hash);
});

test('a link with a corrupted hash loads the local project with a warning', async ({ page }) => {
  // The application rewrites the current state's hash 500 ms after loading. Without waiting
  // for that write, it overwrites `#p1:abc` before the reload and no warning
  // appears: the test only held thanks to the machine's speed.
  await expect.poll(() => new URL(page.url()).hash).toContain('#p1:');
  await page.goto('/#p1:abc');
  await page.reload();
  await expect(page.locator('#toast')).toContainText('lien', {
    ignoreCase: true,
    timeout: 20_000,
  });
  await expect(page.locator('#received-banner')).toBeHidden();
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});
