import { createServer } from 'node:net';
import { defineConfig, devices } from '@playwright/test';

/**
 * Port libre tiré à chaque exécution : plusieurs agents lancent la suite sur la même machine.
 * Un port fixe avec --strictPort fait échouer la suite dès qu'un autre serveur l'occupe.
 * Playwright recharge la configuration dans chaque worker : la variable d'environnement
 * transmet le port déjà choisi pour que tous visent le même serveur.
 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const port = Number(process.env.PLAYWRIGHT_PORT) || (await freePort());
process.env.PLAYWRIGHT_PORT = String(port);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Two workers halve the suite wall time; software WebGL renders stay light per test.
  workers: 2,
  // Software WebGL on the shared Linux runner takes longer than a local GPU.
  timeout: process.env.CI ? 90_000 : 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
