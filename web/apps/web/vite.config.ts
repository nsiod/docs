import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // For GitHub Pages at https://nsiod.github.io/docs/ — override with
  // BASE_PATH env for custom domain or other hosts.
  base: process.env.BASE_PATH ?? '/docs/',
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/app/routes',
      generatedRouteTree: 'src/app/routeTree.gen.ts',
      quoteStyle: 'single',
      semicolons: true,
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3200,
    fs: {
      // Allow reading the sibling docs/ dir through the _docs symlink
      allow: [path.resolve(__dirname, '../../../')],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3200,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
