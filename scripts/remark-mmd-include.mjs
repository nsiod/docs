import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);

/**
 * remarkMmdInclude
 *
 * Finds inline links whose URL targets a `.mmd` file and injects a rendered
 * mermaid code block immediately after the paragraph that contains the link.
 *
 * By the time this plugin runs, rspress has already rewritten relative link
 * URLs to site-absolute paths suffixed with `.html`, so e.g.
 *   `./diagrams/wg-tunnel.mmd` → `/03-data-plane/diagrams/wg-tunnel.mmd.html`
 * We reverse that rewrite before looking the `.mmd` file up under `docs/`.
 */
function resolveMmdPath(sourceDir, url) {
  const bare = url.split('?')[0].split('#')[0];
  // Rspress-rewritten absolute URL: "/03-data-plane/diagrams/foo.mmd.html"
  if (bare.endsWith('.mmd.html')) {
    const rel = bare.slice(0, -'.html'.length).replace(/^\//, '');
    return path.join(DOCS_ROOT, rel);
  }
  // Original author-written relative URL: "./diagrams/foo.mmd"
  if (bare.endsWith('.mmd')) {
    return path.isAbsolute(bare) ? path.join(DOCS_ROOT, bare.replace(/^\//, '')) : path.resolve(sourceDir, bare);
  }
  return null;
}

export default function remarkMmdInclude() {
  return function transformer(tree, file) {
    const sourcePath = file?.history?.[0] ?? file?.path;
    if (!sourcePath) return;
    const sourceDir = path.dirname(sourcePath);

    /** @type {Array<{ parent: any, index: number, value: string }>} */
    const insertions = [];

    visit(tree, 'paragraph', (paragraph, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      for (const child of paragraph.children ?? []) {
        if (child.type !== 'link' || typeof child.url !== 'string') continue;
        const abs = resolveMmdPath(sourceDir, child.url);
        if (!abs || !fs.existsSync(abs)) continue;
        try {
          const source = fs.readFileSync(abs, 'utf8').trim();
          if (source.length === 0) continue;
          insertions.push({ parent, index, value: source });
        }
        catch {
          // ignore unreadable files
        }
        break;
      }
    });

    insertions.sort((a, b) => b.index - a.index);
    for (const { parent, index, value } of insertions) {
      parent.children.splice(index + 1, 0, {
        type: 'code',
        lang: 'mermaid',
        meta: null,
        value,
      });
    }
  };
}
