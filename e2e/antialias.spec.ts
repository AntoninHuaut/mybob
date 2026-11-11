import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('overview antialiasing covers the opaque house silhouette with intermediate pixels', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#view-title')).toHaveText('Vue 3D');
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-view=plan]').click();
    await expect(page.locator('#view-title')).toHaveText('Plan de la maison');
    await page.locator('[data-view=overview]').click();
    await expect(page.locator('#view-title')).toHaveText('Vue 3D');
  }
  await page.getByTitle('Recentrer la vue', { exact: true }).click();
  await page.locator('#export-image').click();
  await page.locator('#image-labels').uncheck();
  await page.locator('#image-dimensions').uncheck();
  await page.locator('#image-header').uncheck();
  await page.locator('#image-transparent').check();
  const downloaded = page.waitForEvent('download');
  await page.locator('#download-scene-image').click();
  const file = testInfo.outputPath('antialias.png');
  await (await downloaded).saveAs(file);
  const png = (await readFile(file)).toString('base64');
  const result = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let edges = 0;
    let blended = 0;
    // First contact with the upper silhouette: no interior glass, material
    // textures or bloom colours can masquerade as geometric coverage here.
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 1; y < canvas.height - 1; y++) {
        const alpha = data[(y * canvas.width + x) * 4 + 3];
        if (alpha <= 8) continue;
        if (data[((y + 1) * canvas.width + x) * 4 + 3] < 248) break;
        edges++;
        if (alpha < 248) blended++;
        break;
      }
    }
    return { edges, blended, width: image.width, height: image.height };
  }, png);
  await testInfo.attach('silhouette-coverage', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.edges, 'the probe must find the house').toBeGreaterThan(100);
  expect(result.blended, '4× MSAA must cover opaque silhouette edges').toBeGreaterThan(30);
});
