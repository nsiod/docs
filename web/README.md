# NSIO Docs · Static Web Viewer

Vite + React 19 + TanStack Router SPA that renders the 11 NSIO architecture
modules from `../docs/` with an interactive ReactFlow ecosystem overview and
per-module Mermaid diagrams.

## Stack

- **Runtime**: Bun workspaces monorepo
- **App**: React 19 + TypeScript (strict) + Vite 6
- **Routing**: TanStack Router (file-based, `src/app/routes/`)
- **Query**: TanStack Query 5
- **State**: Zustand (theme store only — UI state)
- **Styling**: Tailwind CSS 4 with `@theme inline` + oklch tokens
- **UI primitives**: shadcn/ui conventions over `@base-ui-components/react`
- **Icons**: lucide-react
- **Graphs**: `reactflow` (overview + per-module adjacency) + `mermaid` (per-doc)
- **Markdown**: react-markdown + remark-gfm + rehype-slug + rehype-highlight
- **Lint**: ESLint + `@antfu/eslint-config` (react enabled)

## Layout

```
web/
  apps/web/                    # the SPA
    src/
      _docs  -> ../../../docs  # symlink; loaded via import.meta.glob
      app/
        providers.tsx          # QueryClientProvider → ThemeProvider → RouterProvider
        router.ts              # router instance + Register types
        routeTree.gen.ts       # auto-generated (TanStackRouterVite)
        routes/
          __root.tsx           # header + sidebar + <Outlet />
          index.tsx            # home: ReactFlow ecosystem overview
          modules/$moduleId.tsx
      features/
        content/content.ts     # import.meta.glob loader for .md + .mmd
        diagram/               # Mermaid, MermaidFile, ReactFlowDiagram, SourceRef
        ecosystem/graph-data.ts  # 17-node overview + 11 per-module flow specs
        module-viewer/         # ModuleViewer + MarkdownRenderer
      shared/
        components/
          layout/              # Sidebar, ThemeToggle
          ui/                  # tabs, scroll-area (base-ui wrappers)
        hooks/use-theme.ts     # Zustand theme store + matchMedia sync
        lib/utils.ts           # cn()
      index.css                # Tailwind 4 @theme + design tokens + rf-* classes
      main.tsx                 # StrictMode + AppProviders
  packages/
    config/                    # shared tsconfig/{base,react}.json
    shared/                    # ModuleLayer types + LAYER_LABELS/LAYER_GROUPS
```

## Scripts

Run from the repo root (`web/`):

```bash
bun install

# Per-workspace
bun run --filter=@nsio-docs/web dev         # vite dev @ :3200
bun run --filter=@nsio-docs/web typecheck   # tsc --noEmit
bun run --filter=@nsio-docs/web lint        # eslint .
bun run --filter=@nsio-docs/web build       # tsc --noEmit && vite build
bun run --filter=@nsio-docs/web preview     # vite preview @ :3200
```

The dev server binds `0.0.0.0:3200`.

## Content pipeline

`src/_docs` is a symlink to `../../../../docs`. At build time,
`import.meta.glob('/src/_docs/*/*.md', { query: '?raw', eager: true })` inlines
every Markdown file and every `diagrams/*.mmd` file, so the production bundle
has no runtime filesystem dependency.

Cross-module Markdown links (`../02-control-plane/README.md`,
`./design.md`, `diagrams/foo.mmd`) are rewritten to TanStack-Router routes
(`/modules/<id>#doc-<slug>`) by `MarkdownRenderer.rewriteHref`.

`content.ts` exports `getAllModules()`, `getModule(id)`, `findDiagram(id, slug)`.

## Theming

Three-way theme toggle (light / dark / system) in `ThemeToggle`, persisted to
`localStorage.nsio-theme`, applied pre-paint via an inline script in
`index.html` so there is no flash. The `.dark` class on `<html>` drives all
tokens. Mermaid re-initializes with `theme: 'dark' | 'default'` on theme
change.

## Ecosystem overview

`features/ecosystem/graph-data.ts` defines:

- `overviewNodes` — 17 nodes (user, service, NSD×2, NSGW×2, NSN, NSC,
  WireGuard, WSS, Noise/QUIC, SSE, VIP, DNS, netstack, ACL, proxy)
- `overviewEdges` — 22 edges (solid = data, dashed = control / fallback)
- `MODULE_FLOWS` — 11 per-module adjacency specs (6–10 nodes, ≥5 edges each)

Clicking any node with a `moduleLink` navigates to that module page.

## Gates

- `bun run typecheck` — 0 errors
- `bun run lint` — 0 errors (1 `react-refresh/only-export-components` warning on
  `node-types.tsx` which exports both `nodeTypes` and the node component)
- `bun run build` — succeeds; mermaid chunks split automatically
- Headless smoke (dev): home 17 nodes + 22 edges; per-module pages render
  ReactFlow + 3–7 Mermaid SVGs each
