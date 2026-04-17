import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);
const PUBLIC_ROOT = path.join(DOCS_ROOT, 'public');

/**
 * remarkD2Include
 *
 * Finds inline links whose URL targets a `.d2` file and injects an `<img>`
 * pointing to the sibling rendered SVG immediately after the paragraph.
 *
 * By the time this plugin runs, rspress has already rewritten relative link
 * URLs to site-absolute paths suffixed with `.html`, so e.g.
 *   `./diagrams/foo.d2` → `/<section>/diagrams/foo.d2.html`
 * We reverse that rewrite before checking the file exists, and build an
 * image URL that still resolves relative to the source markdown.
 *
 * The `.d2` sources are authored by humans and the sibling `.svg` files are
 * built via `scripts/build-d2.mjs` (hook: `bun run build:d2` / `prebuild`).
 */
function resolveD2(sourceDir, url) {
  const bare = url.split('?')[0].split('#')[0];
  if (bare.endsWith('.d2.html')) {
    const rel = bare.slice(0, -'.html'.length).replace(/^\//, '');
    return { absD2: path.join(DOCS_ROOT, rel), isAbs: true, rel };
  }
  if (bare.endsWith('.d2')) {
    const absD2 = path.isAbsolute(bare)
      ? path.join(DOCS_ROOT, bare.replace(/^\//, ''))
      : path.resolve(sourceDir, bare);
    return { absD2, isAbs: false, rel: bare };
  }
  return null;
}

export default function remarkD2Include() {
  return function transformer(tree, file) {
    const sourcePath = file?.history?.[0] ?? file?.path;
    if (!sourcePath) return;
    const sourceDir = path.dirname(sourcePath);

    /** @type {Array<{ parent: any, index: number, svgUrl: string, alt: string }>} */
    const insertions = [];

    visit(tree, 'paragraph', (paragraph, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      for (const child of paragraph.children ?? []) {
        if (child.type !== 'link' || typeof child.url !== 'string') continue;
        const resolved = resolveD2(sourceDir, child.url);
        if (!resolved) continue;

        // SVG is emitted by scripts/build-d2.mjs into `public/<path-from-docs>.svg`.
        // rspress serves `public/` at the configured base, so a site-absolute URL
        // (without the base prefix — rspress adds it at render time) hits the asset.
        const relFromDocs = path.relative(DOCS_ROOT, resolved.absD2).split(path.sep).join('/');
        const absSvg = path.join(PUBLIC_ROOT, relFromDocs).replace(/\.d2$/, '.svg');
        if (!fs.existsSync(absSvg)) continue;
        const svgUrl = '/' + relFromDocs.replace(/\.d2$/, '.svg');

        const alt = paragraph.children
          .filter((c) => c.type === 'text' || c.type === 'inlineCode')
          .map((c) => c.value ?? '')
          .join(' ')
          .trim() || path.basename(resolved.absD2, '.d2');

        insertions.push({ parent, index, svgUrl, alt });
        break;
      }
    });

    insertions.sort((a, b) => b.index - a.index);
    for (const { parent, index, svgUrl, alt } of insertions) {
      parent.children.splice(index + 1, 0, {
        type: 'paragraph',
        children: [{ type: 'image', url: svgUrl, alt, title: null }],
      });
    }
  };
}
