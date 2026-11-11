import { expect, test, type Page } from '@playwright/test';

/**
 * The render loop draws 32 images after the last change before reporting an idle
 * scene (`RENDER_SETTLE_FRAMES`). Software WebGL in CI runs around three images per
 * second, so the default expect timeout cannot cover a settle window.
 */
const SETTLE_TIMEOUT_MS = 40_000;

async function exportedPixels(page: Page, dimensions: boolean) {
  await page.locator('#export-image').click();
  await page.locator('#image-labels').uncheck();
  await page.locator('#image-dimensions').setChecked(dimensions);
  await page.locator('#image-header').uncheck();
  await page.locator('#image-transparent').check();
  const download = page.waitForEvent('download');
  await page.locator('#download-scene-image').click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('base64');
}

for (const dpr of [1, 2]) {
  test.describe(`screen lines at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test('Plan dimension export toggles preserve CSS stroke coverage', async ({ page }) => {
      await page.goto('/');
      await page.locator('[data-view=plan]').click();
      await expect(page.locator('#view-title')).toHaveText('Plan de la maison');
      const cssWidth = await page.locator('#scene').evaluate((canvas) => canvas.clientWidth);
      const without = await exportedPixels(page, false);
      const withDimensions = await exportedPixels(page, true);
      const result = await page.evaluate(
        async ({ without, withDimensions, cssWidth }) => {
          const decode = async (base64: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            return {
              width: image.width,
              height: image.height,
              data: ctx.getImageData(0, 0, image.width, image.height).data,
            };
          };
          const a = await decode(without),
            b = await decode(withDimensions);
          let houseBottom = 0;
          for (let y = 0; y < a.height; y++)
            for (let x = 0; x < a.width; x++) {
              if (a.data[(y * a.width + x) * 4 + 3] > 8) houseBottom = y;
            }
          houseBottom = Math.ceil((houseBottom * b.height) / a.height);
          const rows = Array.from({ length: b.height }, () => ({ pixels: 0, alpha: 0 }));
          for (let y = houseBottom + 2; y < b.height; y++)
            for (let x = 0; x < b.width; x++) {
              const offset = (y * b.width + x) * 4 + 3;
              const alpha = b.data[offset];
              rows[y].alpha += alpha / 255;
              if (alpha > 8) rows[y].pixels++;
            }
          const peak = Math.max(...rows.map((r) => r.pixels));
          const selected = rows.filter((r) => r.pixels > peak / 2);
          const coverage = selected.reduce((sum, r) => sum + r.alpha, 0) / peak;
          return {
            peak,
            cssStroke: coverage / (b.width / cssWidth),
            width: b.width,
            height: b.height,
          };
        },
        { without, withDimensions, cssWidth },
      );
      console.log(JSON.stringify({ dpr, ...result }));
      expect(result.peak).toBeGreaterThan(100);
      expect(result.cssStroke).toBeGreaterThan(1.1);
      expect(result.cssStroke).toBeLessThan(1.9);
    });
  });
}

test('overview temporal export is stable after settling and Plan round trips', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-view=plan]').click();
    await page.locator('[data-view=overview]').click();
  }
  await page.getByTitle('Recentrer la vue', { exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { mybob: { report(): string } }).mybob.report()),
      { timeout: SETTLE_TIMEOUT_MS },
    )
    .toContain('au repos');
  const first = await exportedPixels(page, false),
    second = await exportedPixels(page, false);
  const result = await page.evaluate(
    async ({ first, second }) => {
      const decode = async (base64: string, size?: { width: number; height: number }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = size?.width ?? image.width;
        c.height = size?.height ?? image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0, c.width, c.height);
        return {
          width: c.width,
          height: c.height,
          data: ctx.getImageData(0, 0, c.width, c.height).data,
        };
      };
      const a = await decode(first),
        b = await decode(second, a);
      let difference = 0,
        opaque = 0;
      for (let i = 3; i < a.data.length; i += 4) {
        difference += Math.abs(a.data[i] - b.data[i]);
        if (a.data[i] > 200) opaque++;
      }
      return { meanAlphaDifference: difference / (a.data.length / 4), opaque };
    },
    { first, second },
  );
  console.log(JSON.stringify(result));
  expect(result.opaque).toBeGreaterThan(1000);
  expect(result.meanAlphaDifference).toBeLessThan(1);
});
