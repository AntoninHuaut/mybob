import type { Page } from '@playwright/test';

/**
 * Waits for the page's start-up to finish: `main.ts` drops the full-page start-up screen's
 * `loading-startup` class once it ends, on success or failure. Start-up awaits work (the
 * project files, the texture worker) before it wires the controls, so a test must not act
 * on the page before this.
 */
export async function startupDone(page: Page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !!loading && !loading.classList.contains('loading-startup');
  });
}
