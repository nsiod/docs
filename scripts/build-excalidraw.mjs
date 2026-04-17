#!/usr/bin/env node
/**
 * build-excalidraw.mjs
 *
 * Walks `docs/**\/*.excalidraw` and renders each to a sibling `.svg` under
 * `docs/public/` using a minimal, zero-dep Excalidraw → SVG renderer.
 *
 * Supported shapes: rectangle, ellipse, diamond, line, arrow, text.
 * Not a full implementation — the point is to demonstrate the static pipeline
 * parallel to `.d2`. Swap in `@excalidraw/excalidraw` + `jsdom` if full
 * fidelity (hachure fills, roughjs hand-drawn look, element bindings) is needed.
 *
 * Invoke via `bun run build:excalidraw` (wired into `dev`/`build`).
 */
import fs from 'node:fs';
import path from 'node:path';

const DOCS_ROOT = path.resolve(new URL('../docs', import.meta.url).pathname);
const PUBLIC_ROOT = path.join(DOCS_ROOT, 'public');
const FORCE = process.argv.includes('--force');
const PAD = 40;
const DEFAULT_STROKE = '#1e1e1e';

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) yield* walk(abs);
    else if (abs.endsWith('.excalidraw')) yield abs;
  }
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rotationAttr(el) {
  if (!el.angle) return '';
  const cx = el.x + (el.width ?? 0) / 2;
  const cy = el.y + (el.height ?? 0) / 2;
  const deg = (el.angle * 180) / Math.PI;
  return ` transform="rotate(${deg.toFixed(2)} ${cx} ${cy})"`;
}

function fillAttr(el) {
  const bg = el.backgroundColor;
  if (!bg || bg === 'transparent') return 'none';
  return bg;
}

function renderElement(el) {
  const stroke = el.strokeColor ?? DEFAULT_STROKE;
  const fill = fillAttr(el);
  const sw = el.strokeWidth ?? 2;
  const dash = el.strokeStyle === 'dashed' ? ' stroke-dasharray="8 4"' :
               el.strokeStyle === 'dotted' ? ' stroke-dasharray="2 4"' : '';
  const rot = rotationAttr(el);
  const opacity = el.opacity != null && el.opacity !== 100 ? ` opacity="${el.opacity / 100}"` : '';

  switch (el.type) {
    case 'rectangle': {
      const rx = el.roundness ? 8 : 0;
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}${opacity}${rot}/>`;
    }
    case 'ellipse': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}${opacity}${rot}/>`;
    }
    case 'diamond': {
      const { x, y, width: w, height: h } = el;
      const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}${opacity}${rot}/>`;
    }
    case 'line':
    case 'arrow': {
      const pts = (el.points ?? [[0, 0]])
        .map(([px, py]) => `${el.x + px},${el.y + py}`)
        .join(' ');
      const markerStart = el.startArrowhead ? ` marker-start="url(#arrowStart-${stroke.replace('#', '')})"` : '';
      const markerEnd = el.type === 'arrow' || el.endArrowhead
        ? ` marker-end="url(#arrowEnd-${stroke.replace('#', '')})"` : '';
      return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}${markerStart}${markerEnd}${opacity}${rot}/>`;
    }
    case 'text': {
      const fontSize = el.fontSize ?? 20;
      const color = el.strokeColor ?? DEFAULT_STROKE;
      const anchor = el.textAlign === 'center' ? 'middle' :
                     el.textAlign === 'right' ? 'end' : 'start';
      const tx = el.textAlign === 'center' ? el.x + (el.width ?? 0) / 2 :
                 el.textAlign === 'right' ? el.x + (el.width ?? 0) :
                 el.x;
      const lines = String(el.text ?? '').split('\n');
      const lineHeight = fontSize * 1.25;
      return lines.map((line, i) =>
        `<text x="${tx}" y="${el.y + fontSize + i * lineHeight}" fill="${color}" font-size="${fontSize}" text-anchor="${anchor}"${opacity}${rot}>${escapeXml(line)}</text>`
      ).join('');
    }
    default:
      return `<!-- unsupported element: ${el.type} -->`;
  }
}

function collectStrokeColors(elements) {
  const set = new Set();
  for (const el of elements) {
    if (el.type === 'line' || el.type === 'arrow') {
      set.add(el.strokeColor ?? DEFAULT_STROKE);
    }
  }
  return Array.from(set);
}

function arrowheadDefs(colors) {
  return colors.flatMap((color) => {
    const id = color.replace('#', '');
    return [
      `<marker id="arrowEnd-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
      `<marker id="arrowStart-${id}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="${color}"/></marker>`,
    ];
  });
}

function computeBBox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + w);
    maxY = Math.max(maxY, el.y + h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 200, h: 100 };
  return {
    x: minX - PAD,
    y: minY - PAD,
    w: maxX - minX + 2 * PAD,
    h: maxY - minY + 2 * PAD,
  };
}

function render(source) {
  const scene = JSON.parse(source);
  const elements = (scene.elements ?? []).filter((el) => !el.isDeleted);
  const bbox = computeBBox(elements);
  const bg = scene.appState?.viewBackgroundColor;
  const bgRect = bg && bg !== 'transparent' && bg !== '#ffffff'
    ? `<rect x="${bbox.x}" y="${bbox.y}" width="${bbox.w}" height="${bbox.h}" fill="${bg}"/>` : '';
  const defs = arrowheadDefs(collectStrokeColors(elements));

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}" width="${bbox.w}" height="${bbox.h}" font-family="Helvetica, Arial, sans-serif">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    bgRect,
    ...elements.map(renderElement),
    '</svg>',
  ];
  return out.filter(Boolean).join('\n');
}

let rendered = 0;
let skipped = 0;
let failed = 0;

for (const src of walk(DOCS_ROOT)) {
  const relFromDocs = path.relative(DOCS_ROOT, src);
  const outPath = path.join(PUBLIC_ROOT, relFromDocs).replace(/\.excalidraw$/, '.svg');
  if (!FORCE && fs.existsSync(outPath)) {
    const srcMtime = fs.statSync(src).mtimeMs;
    const outMtime = fs.statSync(outPath).mtimeMs;
    if (outMtime >= srcMtime) {
      skipped += 1;
      continue;
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const relLabel = path.relative(process.cwd(), src);
  try {
    const svg = render(fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(outPath, svg);
    console.log(`  rendered  ${relLabel}`);
    rendered += 1;
  } catch (e) {
    console.error(`  FAILED    ${relLabel}\n${e.message}`);
    failed += 1;
  }
}

console.log(`\nexcalidraw build: ${rendered} rendered, ${skipped} up-to-date, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
