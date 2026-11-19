/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// @dirty-geometry/vec2 is source-only TypeScript inside the dirty-geometry monorepo.
// `npm run setup` clones it into ./vendor; point DIRTY_GEOMETRY elsewhere to use your own checkout.
const dirtyGeometry = path.resolve(__dirname, process.env.DIRTY_GEOMETRY ?? 'vendor/dirty-geometry');

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@dirty-geometry\/vec2\/(.*)$/, replacement: `${dirtyGeometry}/packages/vec2/src/$1` }],
  },
  server: { fs: { allow: [__dirname, path.resolve(__dirname, '../Backend/samples'), dirtyGeometry] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
