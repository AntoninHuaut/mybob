import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFurniture } from '../src/furniture/model';

// Le lien porte l'état du projet : vérifier l'émission (#p1:), la lecture seule du
// destinataire, l'adoption, le silence pour le propriétaire et la divergence d'un vieux lien.
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

async function importLinkProject(page: Page) {
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
    levels: [level],
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

/** Le hash reprend l'état au plus 500 ms après la dernière modification. */
async function sharedHash(page: Page) {
  await page.locator('#copy-link').click();
  await expect.poll(() => new URL(page.url()).hash).toContain('#p1:');
  return page.url();
}

test('un lien partagé s’ouvre en lecture seule, puis modifiable après l’ajout', async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  await importLinkProject(page);
  const shared = await sharedHash(page);
  await page.close();

  // Un destinataire sans mémoire locale ouvre le lien : bandeau, mutation refusée.
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

    // « Ajouter à mes projets » : copie sous un nouvel identifiant, maintenant modifiable.
    await banner.getByRole('button', { name: 'Ajouter à mes projets' }).click();
    await expect(received.locator('#toast')).toContainText('vos projets');
    await expect(banner).toBeHidden();
    await received.reload();
    await furnishings(received);
    await expect(banner).toBeHidden();
    await expect(
      received.getByRole('button', { name: 'Modifier Canapé lien', exact: true }),
    ).toBeVisible();
    // Le projet possédé réécrit lui aussi le hash, sans bandeau ni dialogue.
    const owned = await sharedHash(received);
    expect(new URL(owned).hash).toContain('#p1:');
  } finally {
    await context.close();
  }
});

test('le propriétaire qui recharge son propre lien ne voit aucun dialogue', async ({ page }) => {
  await importLinkProject(page);
  const shared = await sharedHash(page);
  await page.reload();
  await expect(page.locator('#received-banner')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#project-select option:checked')).toHaveText('Maison du lien');
  await furnishings(page);
  await expect(page.locator('[data-furniture-edit-id]')).toHaveCount(1);
});

test('un lien plus ancien que l’état local propose de garder les deux', async ({ page }) => {
  await importLinkProject(page);
  const older = await sharedHash(page);
  // Une modification après l'émission rend le lien divergent.
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
  const count = await page.locator('#project-select option').count();
  await page.reload();
  await expect(page.locator('#project-select option')).toHaveCount(count);
  await expect(page.locator('#received-banner')).toBeHidden();
});

test('un lien au hash corrompu charge le projet local avec un avertissement', async ({ page }) => {
  await page.goto('/#p1:abc');
  await page.reload();
  await expect(page.locator('#toast')).toContainText('lien', {
    ignoreCase: true,
    timeout: 20_000,
  });
  await expect(page.locator('#received-banner')).toBeHidden();
  await expect(page.locator('#project-select')).toContainText('Démonstration');
});
