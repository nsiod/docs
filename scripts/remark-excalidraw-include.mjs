import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);
const PUBLIC_ROOT = path.join(DOCS_ROOT, 'public');

/**
 * remarkExcalidrawInclude
 *
 * Mirror of `remark-d2-include.mjs` but for `.excalidraw` sources. Finds
 * inline links whose URL targets a `.excalidraw` file and injects an `<img>`
 * pointing to the sibling rendered SVG immediately after the paragraph.
 *
 * By the time this plugin runs rspress has already rewritten relative link
 * URLs to site-absolute paths suffixed with `.html`, so e.g.
 *   `./diagrams/foo.excalidraw` → `/<section>/diagrams/foo.excalidraw.html`
 * We reverse that rewrite before checking the file exists, and build an
 * image URL that still resolves relative to the source markdown.
 *
 * The `.excalidraw` JSON sources are authored in excalidraw.com; sibling
 * `.svg` files are produced by `scripts/build-excalidraw.mjs`.
 */
function resolveExc(sourceDir, url) {
  const bare = url.split('?')[0].split('#')[0];
  if (bare.endsWith('.excalidraw.html')) {
    const rel = bare.slice(0, -'.html'.length).replace(/^\//, '');
    return { abs: path.join(DOCS_ROOT, rel), rel };
  }
  if (bare.endsWith('.excalidraw')) {
    const abs = path.isAbsolute(bare)
      ? path.join(DOCS_ROOT, bare.replace(/^\//, ''))
      : path.resolve(sourceDir, bare);
    return { abs, rel: bare };
  }
  return null;
}

export default function remarkExcalidrawInclude() {
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
        const resolved = resolveExc(sourceDir, child.url);
        if (!resolved) continue;

        const relFromDocs = path.relative(DOCS_ROOT, resolved.abs).split(path.sep).join('/');
        const absSvg = path.join(PUBLIC_ROOT, relFromDocs).replace(/\.excalidraw$/, '.svg');
        if (!fs.existsSync(absSvg)) continue;
        const svgUrl = '/' + relFromDocs.replace(/\.excalidraw$/, '.svg');

        const alt = paragraph.children
          .filter((c) => c.type === 'text' || c.type === 'inlineCode')
          .map((c) => c.value ?? '')
          .join(' ')
          .trim() || path.basename(resolved.abs, '.excalidraw');

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
