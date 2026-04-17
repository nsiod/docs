#!/usr/bin/env node
/**
 * build-d2.mjs
 *
 * Walks `docs/**\/*.d2` and renders each to a sibling `.svg` by shelling out
 * to `d2`. Skips files whose sibling SVG is newer than the source unless
 * `--force` is passed.
 *
 * Invoke via `bun run build:d2` or `bun run prebuild` (wired in package.json).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);
// rspress serves <docsRoot>/public at the site base. Emit SVGs there so the
// built site can link to them via site-absolute URLs without a copy step.
const PUBLIC_ROOT = path.join(DOCS_ROOT, 'public');
const FORCE = process.argv.includes('--force');

const D2_THEME = process.env.D2_THEME ?? '0';       // 0 = Neutral default
const D2_LAYOUT = process.env.D2_LAYOUT ?? 'dagre'; // alternative: elk (needs extra install)
const D2_PAD = process.env.D2_PAD ?? '20';

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) yield* walk(abs);
    else if (abs.endsWith('.d2')) yield abs;
  }
}

let rendered = 0;
let skipped = 0;
let failed = 0;

for (const src of walk(DOCS_ROOT)) {
  // Mirror path into public/ so rspress (which serves public/ at base) can fetch it.
  // docs/06-nsc-client/diagrams/foo.d2  →  public/06-nsc-client/diagrams/foo.svg
  const relFromDocs = path.relative(DOCS_ROOT, src);
  const out = path.join(PUBLIC_ROOT, relFromDocs).replace(/\.d2$/, '.svg');
  if (!FORCE && fs.existsSync(out)) {
    const srcMtime = fs.statSync(src).mtimeMs;
    const outMtime = fs.statSync(out).mtimeMs;
    if (outMtime >= srcMtime) {
      skipped += 1;
      continue;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const relLabel = path.relative(process.cwd(), src);
  try {
    execFileSync('d2', [
      `--theme=${D2_THEME}`,
      `--layout=${D2_LAYOUT}`,
      `--pad=${D2_PAD}`,
      src,
      out,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log(`  rendered  ${relLabel}`);
    rendered += 1;
  } catch (e) {
    const stderr = e.stderr?.toString() ?? e.message;
    console.error(`  FAILED    ${relLabel}\n${stderr}`);
    failed += 1;
  }
}

console.log(`\nd2 build: ${rendered} rendered, ${skipped} up-to-date, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
