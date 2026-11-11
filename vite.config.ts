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
    build: {
      rollupOptions: {
        output: {
          // Babylon changes only when its version does: a label edit in src/ must not
          // invalidate the 2 MB of engine every visitor already cached.
          manualChunks(id) {
            if (!id.includes('/node_modules/@babylonjs/core/')) return undefined;
            // Headset support is reached only through the lazy xrWalk entry.
            if (id.includes('/XR/')) return 'babylon-xr';
            // Shaders stay lazy chunks: merging them would make every visit pay for all of them.
            return /\/Shaders(?:WGSL)?\//.test(id) ? undefined : 'babylon';
          },
        },
      },
    },
    define: {
      __PUBLIC_BUILD__: JSON.stringify(publicBuild),
      __PRIVATE_PROJECTS__: JSON.stringify(privateProjects),
    },
    plugins: publicBuild
      ? [
          {
            name: 'keep-xr-lazy',
            generateBundle(_, bundle) {
              const visited = new Set<string>();
              const visit = (file: string) => {
                if (visited.has(file)) return;
                visited.add(file);
                const chunk = bundle[file];
                if (chunk?.type !== 'chunk') return;
                if (Object.keys(chunk.modules).some((id) => id.includes('/@babylonjs/core/XR/'))) {
                  this.error(`WebXR code reached the initial download: ${file}`);
                }
                chunk.imports.forEach(visit);
              };
              for (const chunk of Object.values(bundle)) {
                if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName);
              }
            },
          },
          {
            name: 'public-demo-only',
            generateBundle() {
              for (const name of ['favicon.svg', '_headers', 'projects/studio-demo.json']) {
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
