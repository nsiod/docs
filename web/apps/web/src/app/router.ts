import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Keep in sync with vite.config.ts `base`. Strip trailing slash for TanStack
// Router basepath (it expects '/docs', not '/docs/').
const rawBase = import.meta.env.BASE_URL ?? '/';
const basepath = rawBase === '/' ? undefined : rawBase.replace(/\/$/, '');

export const router = createRouter({
  routeTree,
  basepath,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
