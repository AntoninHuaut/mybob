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
  // Second niveau du même contour : les identifiants sont uniques à travers tous les niveaux.
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

test('changer de niveau garde le projet reçu, sans repasser par la démonstration', async ({
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

    // Le pack renumérote les identifiants de niveau : le libellé, lui, est conservé.
    await received.locator('#level-select').selectOption({ label: 'Étage du lien' });

    // Le projet reçu ne figure pas dans la liste des projets : le recharger par son
    // identifiant retombait sur la démonstration.
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
  const before = await page.locator('#project-select option').count();
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
  // L'adoption est asynchrone : compter avant qu'elle n'ait installé la copie ferait
  // croire que le rechargement ajoute un projet.
  await expect(page.locator('#toast')).toContainText('vos projets');
  await expect(page.locator('#project-select option')).toHaveCount(before + 1);
  await page.reload();
  await expect(page.locator('#project-select option')).toHaveCount(before + 1);
  await expect(page.locator('#received-banner')).toBeHidden();
});

test('à 10 projets, « Garder les deux » propose de remplacer un projet, sans écran fatal', async ({
  page,
}) => {
  // Neuf projets déjà conservés, le dixième est celui du lien.
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

  // Chaque ouverture du lien se fait dans un nouvel onglet : un onglet qui a écrit le hash de
  // son état reconnaît son propre lien au rechargement et n'affiche alors aucun dialogue.
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

  // Annuler ne supprime ni n'ajoute rien.
  await limit.getByRole('button', { name: 'Annuler' }).click();
  await expect(first.getByRole('dialog')).toHaveCount(0);
  await expect(first.locator('#project-select option')).toHaveCount(total);

  // Remplacer : la copie est ajoutée, le projet choisi disparaît, le total reste à 10 importés.
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

test('un lien au hash corrompu charge le projet local avec un avertissement', async ({ page }) => {
  // L'application réécrit le hash de l'état courant 500 ms après le chargement. Sans attendre
  // cette écriture, elle écrase `#p1:abc` avant le rechargement et aucun avertissement
  // n'apparaît : le test ne tenait qu'à la vitesse de la machine.
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
