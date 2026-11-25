import type { Page } from '@playwright/test';

/**
 * Waits for the page's start-up to finish, or to stop on a question: `main.ts` drops the
 * full-page start-up screen's `loading-startup` class once it ends (success or failure), and a
 * received link may first ask in a modal dialog. Start-up awaits work (the project files, the
 * texture worker) before it wires the controls, so a test must not act on the page before this.
 */
export async function startupDone(page: Page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    if (!loading) return false;
    return (
      !loading.classList.contains('loading-startup') || !!document.querySelector('dialog[open]')
    );
  });
}
