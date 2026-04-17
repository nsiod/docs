# NSIO Docs · Static Web Viewer

Vite + React 19 + TanStack Router SPA that renders the 11 NSIO architecture
modules from `../docs/` with an interactive Mermaid ecosystem overview and
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
- **Graphs**: `mermaid` (overview + per-module adjacency + per-doc diagrams)
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
          index.tsx            # home: Mermaid ecosystem overview
          modules/$moduleId.tsx
      features/
        content/content.ts     # import.meta.glob loader for .md + .mmd
        diagram/               # Mermaid, MermaidFile, SourceRef
        ecosystem/graph-data.ts  # overview chart + 11 per-module mermaid specs
        module-viewer/         # ModuleViewer + MarkdownRenderer
      shared/
        components/
          layout/              # Sidebar, ThemeToggle
          ui/                  # tabs, scroll-area (base-ui wrappers)
        hooks/use-theme.ts     # Zustand theme store + matchMedia sync
        lib/utils.ts           # cn()
      index.css                # Tailwind 4 @theme + design tokens
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

- `buildOverviewChart(basepath)` — top-level NSIO ecosystem mermaid flowchart
  grouping Control Plane / User Edge / Transport / Site Node
- `MODULE_FLOWS` — 11 per-module adjacency specs (6–10 nodes, ≥5 edges each)
- `getModuleChart(moduleId, basepath)` — renders a per-module mermaid chart
  from a spec, including `click … href` navigation to documentation pages

Every chart uses mermaid `click` directives so node taps route to the matching
module page. `basepath` is derived from `import.meta.env.BASE_URL` so links
work under GitHub Pages (`/docs/`) or any other subdirectory deployment.

## Gates

- `bun run typecheck` — 0 errors
- `bun run lint` — 0 errors
- `bun run build` — succeeds; mermaid chunks split automatically
