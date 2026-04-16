import type { ModuleLayer } from '@shared/index';

/** All markdown files under docs/MM-name/...md, keyed by path relative to this module. */
const mdModules = import.meta.glob('/src/_docs/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** All mermaid source files under docs/MM-name/diagrams/*.mmd. */
const mmdModules = import.meta.glob('/src/_docs/*/diagrams/*.mmd', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface DocFile {
  readonly slug: string;
  readonly filename: string;
  readonly title: string;
  readonly content: string;
  readonly headings: ReadonlyArray<{ readonly level: number; readonly text: string }>;
}

export interface MermaidFile {
  readonly slug: string;
  readonly filename: string;
  readonly source: string;
}

export interface ModuleEntry {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly layer: ModuleLayer;
  readonly docs: DocFile[];
  readonly diagrams: MermaidFile[];
}

const LAYER_MAP: Record<string, ModuleLayer> = {
  '01-overview': 'describe',
  '02-control-plane': 'describe',
  '03-data-plane': 'describe',
  '04-network-stack': 'describe',
  '05-proxy-acl': 'describe',
  '06-nsc-client': 'describe',
  '07-nsn-node': 'describe',
  '08-nsd-control': 'describe',
  '09-nsgw-gateway': 'describe',
  '10-nsn-nsc-critique': 'critique',
  '11-nsd-nsgw-vision': 'vision',
};

const SUMMARIES: Record<string, string> = {
  '01-overview': '系统总览、四大组件职责、数据流、DNS 命名与传输协议设计。',
  '02-control-plane':
    'NSN 侧控制面：machinekey/peerkey 认证、SSE/Noise/QUIC 传输、多 NSD 配置合并。',
  '03-data-plane':
    '数据面：tunnel-wg (gotatun UAPI)、tunnel-ws (WsFrame)、connector 自动回退。',
  '04-network-stack':
    '网络栈：smoltcp VirtualDevice、PacketNat DNAT/SNAT、HybridNatSend 混合路径。',
  '05-proxy-acl':
    '代理与 ACL：TCP/UDP 双向转发、HTTP Host / TLS SNI 嗅探、仅允许 ACL 引擎。',
  '06-nsc-client':
    'NSC 用户客户端：127.11.x.x 虚 IP、本地 DNS、NscRouter、HTTP 代理。',
  '07-nsn-node':
    'NSN 二进制入口 + 监控 HTTP API (/healthz, /api/*) + OTel/Prometheus 观测。',
  '08-nsd-control':
    'NSD 控制中心：注册/认证/SSE 配置分发/多 realm/mock vs 生产对齐。',
  '09-nsgw-gateway':
    'NSGW 数据网关：traefik 反代、内核 WG、Bun WSS 中继、多区域部署。',
  '10-nsn-nsc-critique':
    '反向架构审查：70+ 条缺陷（架构/功能/失败/性能/观测/安全）+ 改进路线图。',
  '11-nsd-nsgw-vision':
    '前向设计愿景：NSD+NSGW 生产级能力模型、功能矩阵、Phase 0-3 路线图。',
};

function extractHeadings(content: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence)
      continue;
    const m = /^(#{1,6}) (.+)$/.exec(line);
    if (m && m[1] && m[2]) {
      out.push({ level: m[1].length, text: m[2].trim() });
    }
  }
  return out;
}

function extractTitle(content: string, fallback: string): string {
  const first = extractHeadings(content).find((h) => h.level === 1);
  return first?.text ?? fallback;
}

function extractSummary(content: string): string {
  const lines = content.split(/\r?\n/);
  let seenH1 = false;
  const buf: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!seenH1) {
      if (line.startsWith('# '))
        seenH1 = true;
      continue;
    }
    if (line === '') {
      if (buf.length > 0)
        break;
      continue;
    }
    if (line.startsWith('#')) {
      if (buf.length > 0)
        break;
      continue;
    }
    if (line.startsWith('>')) {
      buf.push(line.replace(/^>+\s*/, ''));
      continue;
    }
    if (line.startsWith('|') || line.startsWith('---'))
      break;
    buf.push(line);
  }
  return buf.join(' ').slice(0, 300);
}

function parseDocPath(path: string): { moduleId: string; filename: string } | null {
  // expected: /src/_docs/<moduleId>/<filename>.md
  const m = path.match(/^\/src\/_docs\/([^/]+)\/([^/]+\.md)$/);
  if (!m || !m[1] || !m[2])
    return null;
  return { moduleId: m[1], filename: m[2] };
}

function parseMmdPath(path: string): { moduleId: string; filename: string } | null {
  const m = path.match(/^\/src\/_docs\/([^/]+)\/diagrams\/([^/]+\.mmd)$/);
  if (!m || !m[1] || !m[2])
    return null;
  return { moduleId: m[1], filename: m[2] };
}

let cache: ModuleEntry[] | null = null;

export function getAllModules(): ModuleEntry[] {
  if (cache)
    return cache;

  const byModule: Record<string, { docs: DocFile[]; diagrams: MermaidFile[] }> = {};

  for (const [path, raw] of Object.entries(mdModules)) {
    const parsed = parseDocPath(path);
    if (!parsed || !/^\d{2}-/.test(parsed.moduleId))
      continue;
    const slug = parsed.filename.replace(/\.md$/, '').toLowerCase();
    byModule[parsed.moduleId] ??= { docs: [], diagrams: [] };
    byModule[parsed.moduleId]!.docs.push({
      slug,
      filename: parsed.filename,
      title: extractTitle(raw, parsed.filename),
      content: raw,
      headings: extractHeadings(raw),
    });
  }

  for (const [path, raw] of Object.entries(mmdModules)) {
    const parsed = parseMmdPath(path);
    if (!parsed || !/^\d{2}-/.test(parsed.moduleId))
      continue;
    const slug = parsed.filename.replace(/\.mmd$/, '').toLowerCase();
    byModule[parsed.moduleId] ??= { docs: [], diagrams: [] };
    byModule[parsed.moduleId]!.diagrams.push({
      slug,
      filename: parsed.filename,
      source: raw,
    });
  }

  const ids = Object.keys(byModule).sort();
  const modules: ModuleEntry[] = ids.map((id) => {
    const bucket = byModule[id]!;
    bucket.docs.sort((a, b) => {
      if (a.slug === 'readme')
        return -1;
      if (b.slug === 'readme')
        return 1;
      return a.slug.localeCompare(b.slug);
    });
    bucket.diagrams.sort((a, b) => a.slug.localeCompare(b.slug));
    const readme = bucket.docs.find((d) => d.slug === 'readme');
    const order = Number.parseInt(id.slice(0, 2), 10) || 0;
    const title = readme?.title ?? id;
    let summary = SUMMARIES[id] ?? '';
    if (!summary && readme)
      summary = extractSummary(readme.content);
    return {
      id,
      order,
      title,
      summary,
      layer: LAYER_MAP[id] ?? 'describe',
      docs: bucket.docs,
      diagrams: bucket.diagrams,
    };
  });

  cache = modules;
  return modules;
}

export function getModule(id: string): ModuleEntry | undefined {
  return getAllModules().find((m) => m.id === id);
}

export function findDiagram(moduleId: string, slug: string): MermaidFile | undefined {
  return getModule(moduleId)?.diagrams.find((d) => d.slug === slug);
}
