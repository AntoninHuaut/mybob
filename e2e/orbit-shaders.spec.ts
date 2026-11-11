import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('repeated automatic cutaways reuse shader programs while orbiting', async ({ page }) => {
  // Six software-rendered orbit sweeps sit at 55-90 s on CI against the 90 s default.
  test.slow();
  await page.addInitScript(() => {
    const trackLinks = (prototype: typeof WebGLRenderingContext.prototype) => {
      const link = prototype.linkProgram;
      const remove = prototype.deleteProgram;
      prototype.linkProgram = function (program) {
        (window as unknown as { shaderLinks: number }).shaderLinks++;
        return link.call(this, program);
      };
      prototype.deleteProgram = function (program) {
        (window as unknown as { shaderDeletes: number }).shaderDeletes++;
        return remove.call(this, program);
      };
    };
    (window as unknown as { shaderLinks: number }).shaderLinks = 0;
    (window as unknown as { shaderDeletes: number }).shaderDeletes = 0;
    trackLinks(WebGLRenderingContext.prototype);
    if (WebGL2RenderingContext.prototype.hasOwnProperty('linkProgram'))
      trackLinks(WebGL2RenderingContext.prototype);
  });
  await page.goto('/');
  await expect(page.locator('#project-select')).toContainText('Démonstration');
  const canvas = page.locator('#scene');
  const box = (await canvas.boundingBox())!;
  const rotate = async () => {
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + box.width * 0.85, y, { steps: 15 });
      await page.mouse.move(box.x + box.width * 0.15, y, { steps: 15 });
    }
    await page.mouse.up();
  };
  await rotate();
  const links = await page.evaluate(
    () => (window as unknown as { shaderLinks: number }).shaderLinks,
  );
  expect(links).toBeGreaterThan(0);
  await rotate();
  expect(
    await page.evaluate(() => (window as unknown as { shaderLinks: number }).shaderLinks),
  ).toBe(links);
  const deletes = await page.evaluate(
    () => (window as unknown as { shaderDeletes: number }).shaderDeletes,
  );
  const demo = JSON.parse(await readFile('public/projects/studio-demo.json', 'utf8'));
  demo.id = 'shader-cache-test';
  demo.name = 'Shader cache test';
  await page.locator('#import-file').setInputFiles({
    name: 'demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(demo)),
  });
  await expect(page.locator('#project-select option:checked')).toHaveText('Shader cache test');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shaderDeletes: number }).shaderDeletes))
    .toBeGreaterThan(deletes);
});
