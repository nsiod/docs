import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);
const PUBLIC_ROOT = path.join(DOCS_ROOT, 'public');

/**
 * remarkD2Include
 *
 * Transforms `.d2` links so no 404-producing `<a href=".../foo.d2.html">` ends
 * up in the rendered HTML. The `.d2` is source, not a page — rspress rewrites
 * `./foo.d2` → `/<section>/foo.d2.html`, which never resolves.
 *
 * Two cases:
 *   1. Link is the only content of a paragraph → replace the whole paragraph
 *      with an `<img>` pointing at the sibling rendered SVG.
 *   2. Link appears anywhere else (table cell, list item, inline mix) → strip
 *      the `<a>` wrapper but keep its inner text, so `diagrams/foo.d2` still
 *      reads as source in tables without being clickable.
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

function svgUrlFor(resolved) {
  const relFromDocs = path.relative(DOCS_ROOT, resolved.absD2).split(path.sep).join('/');
  const absSvg = path.join(PUBLIC_ROOT, relFromDocs).replace(/\.d2$/, '.svg');
  if (!fs.existsSync(absSvg)) return null;
  return '/' + relFromDocs.replace(/\.d2$/, '.svg');
}

export default function remarkD2Include() {
  return function transformer(tree, file) {
    const sourcePath = file?.history?.[0] ?? file?.path;
    if (!sourcePath) return;
    const sourceDir = path.dirname(sourcePath);

    /** @type {Array<{ parent: any, index: number, svgUrl: string, alt: string }>} */
    const paragraphReplacements = [];

    // Pass 1: paragraphs that are just a link to a `.d2` → replace with <img>.
    visit(tree, 'paragraph', (paragraph, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      for (const child of paragraph.children ?? []) {
        if (child.type !== 'link' || typeof child.url !== 'string') continue;
        const resolved = resolveD2(sourceDir, child.url);
        if (!resolved) continue;
        const svgUrl = svgUrlFor(resolved);
        if (!svgUrl) continue;

        const alt = paragraph.children
          .filter((c) => c.type === 'text' || c.type === 'inlineCode')
          .map((c) => c.value ?? '')
          .join(' ')
          .trim() || path.basename(resolved.absD2, '.d2');

        paragraphReplacements.push({ parent, index, svgUrl, alt });
        break;
      }
    });

    paragraphReplacements.sort((a, b) => b.index - a.index);
    for (const { parent, index, svgUrl, alt } of paragraphReplacements) {
      parent.children.splice(index, 1, {
        type: 'paragraph',
        children: [{ type: 'image', url: svgUrl, alt, title: null }],
      });
    }

    // Pass 2: any remaining `<a href="...d2[.html]">` anywhere (tables, lists,
    // inline runs) → unwrap to its inner text/inlineCode nodes, so the link is
    // gone but the label survives.
    visit(tree, 'link', (link, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (typeof link.url !== 'string') return;
      if (!resolveD2(sourceDir, link.url)) return;
      parent.children.splice(index, 1, ...(link.children ?? []));
    });
  };
}
