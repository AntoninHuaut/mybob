import { expect, test, type Page } from '@playwright/test';

// Two tabs on the same house: the second must never overwrite the first one's work.
async function openTab(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Plan', exact: true })).toBeEnabled();
}

async function addFurniture(page: Page, name: string) {
  const menu = page.locator('#toggle-sidebar');
  if (await menu.isVisible()) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  }
  await page.getByRole('tab', { name: /Meubles/ }).click();
  await page.getByRole('button', { name: 'Ajouter un meuble', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill(name);
  await dialog
    .getByLabel(/Largeur/)
    .first()
    .fill('90');
  await dialog.getByRole('button', { name: 'Ajouter dans la maison' }).click();
}

const stored = (page: Page) =>
  page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('maison-atelier:variants:v1:'))
      .map(([, value]) => value)
      .join('\n'),
  );

test('the second tab is read-only and does not delete the first one’s sofa', async ({
  context,
}) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await openTab(a);
  await openTab(b);

  await addFurniture(a, 'Canapé onglet A');
  await expect.poll(() => stored(a)).toContain('Canapé onglet A');

  // The storage event warns tab B; its addition is refused and nothing is written.
  await expect(b.locator('#stale-banner')).toBeVisible();
  await addFurniture(b, 'Table onglet B');
  const draft = b.getByRole('dialog', { name: 'Ajouter un meuble', exact: true });
  await expect(draft).toContainText('autre onglet');
  await draft.getByRole('button', { name: 'Annuler' }).click();
  const after = await stored(a);
  expect(after).toContain('Canapé onglet A');
  expect(after).not.toContain('Table onglet B');

  await b.getByRole('button', { name: 'Recharger' }).click();
  await expect(b.getByRole('button', { name: 'Plan', exact: true })).toBeEnabled();
  await expect(b.locator('#stale-banner')).toHaveCount(0);
});
