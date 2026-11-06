import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Personal project data is opt-in, never part of a normal deployment.
export default defineConfig(({ mode }) => {
  const publicBuild = mode !== 'private';
  const privateProjects = publicBuild
    ? []
    : readdirSync(new URL('./public/projects', import.meta.url))
        .filter((name) => /^private-.*\.json$/.test(name))
        .sort()
        .map((name) => `/projects/${name}`);
  return {
    // Deep Babylon imports must share one shader registry in the development server.
    optimizeDeps: { exclude: ['@babylonjs/core'] },
    publicDir: publicBuild ? false : 'public',
    define: {
      __PUBLIC_BUILD__: JSON.stringify(publicBuild),
      __PRIVATE_PROJECTS__: JSON.stringify(privateProjects),
    },
    plugins: publicBuild
      ? [
          {
            name: 'public-demo-only',
            generateBundle() {
              for (const name of ['favicon.svg', 'projects/studio-demo.json']) {
                this.emitFile({
                  type: 'asset',
                  fileName: name,
                  source: readFileSync(new URL(`./public/${name}`, import.meta.url)),
                });
              }
            },
            configureServer(server) {
              server.middlewares.use((request, response, next) => {
                const files: Record<string, string> = {
                  '/favicon.svg': 'favicon.svg',
                  '/projects/studio-demo.json': 'projects/studio-demo.json',
                };
                const file = files[(request.url ?? '').split('?')[0]];
                if (!file) return next();
                response.setHeader(
                  'Content-Type',
                  file.endsWith('.json') ? 'application/json' : 'image/svg+xml',
                );
                response.end(readFileSync(new URL(`./public/${file}`, import.meta.url)));
              });
            },
          },
        ]
      : [],
  };
});
