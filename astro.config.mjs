import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';

/**
 * Test pages live in src/dev-pages/test-*.astro (not src/pages), so production builds never include them.
 * In `astro dev` each one is injected at its usual URL (/test-<name>). New test pages: drop them in that folder
 * (a dev-server restart picks them up).
 */
const devTestPages = {
  name: 'dev-test-pages',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command !== 'dev') return;
      const dir = new URL('./src/dev-pages/', import.meta.url);
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const m = /^(test-[\w-]+)\.astro$/.exec(f);
        if (m) injectRoute({ pattern: `/${m[1]}`, entrypoint: `./src/dev-pages/${f}` });
      }
    },
  },
};

export default defineConfig({
  // the repo's existing Pages workflow uploads dist/client
  outDir: 'dist/client',
  integrations: [devTestPages],
  vite: {
    plugins: [tailwindcss()],
    build: {
      target: 'es2022',
      // three in its own chunk: with a single page Rollup otherwise hoists three.core into the entry script,
      // which then has to download/parse ~250 kB before the page script even starts
      rollupOptions: { output: { manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined) } },
    },
  },
  server: { port: 4380 },
  markdown: { shikiConfig: { theme: 'vitesse-black', wrap: false } },
  devToolbar: { enabled: false },
});
