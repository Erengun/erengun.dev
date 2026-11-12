import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  vite: { plugins: [tailwindcss()], build: { target: 'es2022' } },
  server: { port: 4380 },
  devToolbar: { enabled: false },
});
