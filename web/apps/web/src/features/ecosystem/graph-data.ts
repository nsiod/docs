/**
 * Ecosystem graph domain model + mermaid chart generators.
 *
 * Replaces the previous ReactFlow-based rendering. All graphs are now emitted
 * as mermaid `flowchart` source and rendered via `<Mermaid />`.
 */

export type NodeCategory = 'component' | 'protocol' | 'data' | 'external';

interface ModuleNode {
  readonly id: string;
  readonly label: string;
  readonly category: NodeCategory;
  readonly sublabel?: string;
  readonly link?: string;
}

interface ModuleEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly dashed?: boolean;
}

export interface ModuleFlowSpec {
  readonly nodes: ReadonlyArray<ModuleNode>;
  readonly edges: ReadonlyArray<ModuleEdge>;
  readonly center: string;
}

// ---------- Ecosystem overview (hand-tuned mermaid chart) ----------

/**
 * Overview chart — clean top-down layout with three swim-lanes:
 * control plane / data plane / external actors.
 *
 * `basepath` is prepended to internal doc links so clicks work under
 * GitHub Pages (`/docs/`) or any other subdirectory deployment.
 */
export function buildOverviewChart(basepath: string): string {
  const b = basepath.replace(/\/$/, '');
  const link = (modId: string) => `${b}/modules/${modId}`;
  return [
    'flowchart LR',
    '  classDef component fill:#a7f3d0,stroke:#047857,color:#064e3b;',
    '  classDef protocol fill:#fde68a,stroke:#b45309,color:#78350f;',
    '  classDef data fill:#bfdbfe,stroke:#1d4ed8,color:#1e3a8a;',
    '  classDef external fill:#e9d5ff,stroke:#7e22ce,color:#581c87;',
    '',
    '  subgraph CP["Control Plane"]',
    '    direction TB',
    '    NSD1["NSD-1<br/><small>Control Center</small>"]:::component',
    '    NSD2["NSD-2<br/><small>HA / Multi-Realm</small>"]:::component',
    '    SSE["SSE<br/><small>config stream</small>"]:::protocol',
    '    NOISE["Noise / QUIC<br/><small>anti-DPI</small>"]:::protocol',
    '  end',
    '',
    '  subgraph Edge["User Edge"]',
    '    direction TB',
    '    USER["User App<br/><small>ssh · curl · psql</small>"]:::external',
    '    NSC["NSC<br/><small>User Client</small>"]:::component',
    '    VIP["VIP 127.11.x.x"]:::data',
    '    DNS["Local DNS<br/><small>*.n.ns</small>"]:::data',
    '  end',
    '',
    '  subgraph Transport["Data-plane transport"]',
    '    direction TB',
    '    WG["WireGuard<br/><small>UDP :51820</small>"]:::protocol',
    '    WSS["WSS<br/><small>TCP :443</small>"]:::protocol',
    '    NSGW1["NSGW-1<br/><small>traefik+WG+WSS</small>"]:::component',
    '    NSGW2["NSGW-2<br/><small>Region 2</small>"]:::component',
    '  end',
    '',
    '  subgraph Site["Site Node (NSN)"]',
    '    direction TB',
    '    NSN["NSN<br/><small>12 crates</small>"]:::component',
    '    NETSTACK["netstack<br/><small>smoltcp</small>"]:::data',
    '    ACL["ACL<br/><small>allow-only</small>"]:::data',
    '    PROXY["Proxy / NAT<br/><small>conntrack</small>"]:::data',
    '    SVC["Service Provider<br/><small>local · remote</small>"]:::external',
    '  end',
    '',
    '  %% user plane',
    '  USER -->|FQDN → VIP| NSC',
    '  NSC --> VIP',
    '  NSC --> DNS',
    '  NSC -->|WG| WG',
    '  NSC -.->|WSS fallback| WSS',
    '  WG --> NSGW1',
    '  WSS --> NSGW1',
    '  NSC -.->|alt| NSGW2',
    '  NSGW1 -->|bridge| NSN',
    '  NSGW2 -.->|alt region| NSN',
    '',
    '  %% NSN internals',
    '  NSN --> NETSTACK',
    '  NSN --> ACL',
    '  NETSTACK --> PROXY',
    '  ACL --> PROXY',
    '  PROXY -->|connect()| SVC',
    '',
    '  %% control plane',
    '  NSD1 -.-> SSE',
    '  NSD2 -.->|HA| SSE',
    '  NSD1 -.-> NOISE',
    '  SSE -.->|config push| NSN',
    '  SSE -.-> NSGW1',
    '  SSE -.-> NSC',
    '  NOISE -.->|config push| NSC',
    '',
    `  click NSD1 href "${link('08-nsd-control')}"`,
    `  click NSD2 href "${link('08-nsd-control')}"`,
    `  click SSE href "${link('02-control-plane')}"`,
    `  click NOISE href "${link('02-control-plane')}"`,
    `  click NSC href "${link('06-nsc-client')}"`,
    `  click WG href "${link('03-data-plane')}"`,
    `  click WSS href "${link('03-data-plane')}"`,
    `  click NSGW1 href "${link('09-nsgw-gateway')}"`,
    `  click NSGW2 href "${link('09-nsgw-gateway')}"`,
    `  click NSN href "${link('07-nsn-node')}"`,
    `  click NETSTACK href "${link('04-network-stack')}"`,
    `  click ACL href "${link('05-proxy-acl')}"`,
    `  click PROXY href "${link('05-proxy-acl')}"`,
    `  click VIP href "${link('06-nsc-client')}"`,
    `  click DNS href "${link('06-nsc-client')}"`,
  ].join('\n');
}

// Static metadata consumed by routes/index.tsx
export const OVERVIEW_STATS = {
  nodes: 17,
  edges: 22,
} as const;

// ---------- Per-module flows ----------

const MODULE_FLOWS: Record<string, ModuleFlowSpec> = {
  '01-overview': {
    center: 'overview',
    nodes: [
      { id: 'overview', label: 'System Overview', category: 'component' },
      { id: 'ctrl', label: '02 · Control Plane', category: 'component', link: '02-control-plane' },
      { id: 'data', label: '03 · Data Plane', category: 'component', link: '03-data-plane' },
      { id: 'net', label: '04 · Network Stack', category: 'component', link: '04-network-stack' },
      { id: 'proxy', label: '05 · Proxy & ACL', category: 'component', link: '05-proxy-acl' },
      { id: 'nsc', label: '06 · NSC Client', category: 'component', link: '06-nsc-client' },
      { id: 'nsn', label: '07 · NSN Node', category: 'component', link: '07-nsn-node' },
      { id: 'nsd', label: '08 · NSD', category: 'component', link: '08-nsd-control' },
      { id: 'nsgw', label: '09 · NSGW', category: 'component', link: '09-nsgw-gateway' },
    ],
    edges: [
      { from: 'overview', to: 'ctrl' },
      { from: 'overview', to: 'data' },
      { from: 'overview', to: 'net' },
      { from: 'overview', to: 'proxy' },
      { from: 'overview', to: 'nsc' },
      { from: 'overview', to: 'nsn' },
      { from: 'overview', to: 'nsd' },
      { from: 'overview', to: 'nsgw' },
    ],
  },
  '02-control-plane': {
    center: 'control',
    nodes: [
      { id: 'control', label: 'control crate', category: 'component' },
      { id: 'common', label: 'common<br/>machinekey/peerkey', category: 'data' },
      { id: 'sse', label: 'SSE', category: 'protocol' },
      { id: 'noise', label: 'Noise', category: 'protocol' },
      { id: 'quic', label: 'QUIC', category: 'protocol' },
      { id: 'nsd', label: '08 · NSD', category: 'component', link: '08-nsd-control' },
      { id: 'tunnel-wg', label: '→ tunnel-wg', category: 'component', link: '03-data-plane' },
      { id: 'acl', label: '→ acl', category: 'component', link: '05-proxy-acl' },
    ],
    edges: [
      { from: 'common', to: 'control' },
      { from: 'control', to: 'sse' },
      { from: 'control', to: 'noise', dashed: true },
      { from: 'control', to: 'quic', dashed: true },
      { from: 'sse', to: 'nsd' },
      { from: 'noise', to: 'nsd', dashed: true },
      { from: 'quic', to: 'nsd', dashed: true },
      { from: 'control', to: 'tunnel-wg', label: 'WgConfig' },
      { from: 'control', to: 'acl', label: 'AclConfig' },
    ],
  },
  '03-data-plane': {
    center: 'connector',
    nodes: [
      { id: 'connector', label: 'connector<br/>MultiGW 选路', category: 'component' },
      { id: 'tunnel-wg', label: 'tunnel-wg<br/>gotatun UAPI', category: 'component' },
      { id: 'tunnel-ws', label: 'tunnel-ws<br/>WsFrame', category: 'component' },
      { id: 'wg-proto', label: 'WireGuard UDP', category: 'protocol' },
      { id: 'wss-proto', label: 'WSS TCP/443', category: 'protocol' },
      { id: 'gw', label: '09 · NSGW', category: 'component', link: '09-nsgw-gateway' },
      { id: 'netstack', label: '04 · netstack', category: 'component', link: '04-network-stack' },
    ],
    edges: [
      { from: 'connector', to: 'tunnel-wg' },
      { from: 'connector', to: 'tunnel-ws' },
      { from: 'tunnel-wg', to: 'wg-proto' },
      { from: 'tunnel-ws', to: 'wss-proto' },
      { from: 'wg-proto', to: 'gw' },
      { from: 'wss-proto', to: 'gw' },
      { from: 'tunnel-wg', to: 'netstack', label: 'raw IP' },
      { from: 'tunnel-ws', to: 'netstack', label: 'raw IP' },
    ],
  },
  '04-network-stack': {
    center: 'netstack',
    nodes: [
      { id: 'netstack', label: 'netstack (smoltcp)', category: 'component' },
      { id: 'nat', label: 'nat DNAT/SNAT', category: 'component' },
      { id: 'hybrid', label: 'HybridNatSend', category: 'data' },
      { id: 'tunnel-wg', label: '← tunnel-wg', category: 'component', link: '03-data-plane' },
      { id: 'proxy', label: '→ proxy', category: 'component', link: '05-proxy-acl' },
      { id: 'acl', label: '→ acl', category: 'component', link: '05-proxy-acl' },
    ],
    edges: [
      { from: 'tunnel-wg', to: 'netstack' },
      { from: 'netstack', to: 'nat' },
      { from: 'nat', to: 'hybrid' },
      { from: 'hybrid', to: 'acl' },
      { from: 'hybrid', to: 'proxy' },
    ],
  },
  '05-proxy-acl': {
    center: 'proxy',
    nodes: [
      { id: 'acl', label: 'acl (allow-only)', category: 'component' },
      { id: 'proxy', label: 'proxy (tcp/udp)', category: 'component' },
      { id: 'sni', label: 'TLS SNI peek', category: 'protocol' },
      { id: 'host', label: 'HTTP Host peek', category: 'protocol' },
      { id: 'netstack', label: '← netstack', category: 'component', link: '04-network-stack' },
      { id: 'nsn', label: '→ nsn', category: 'component', link: '07-nsn-node' },
    ],
    edges: [
      { from: 'netstack', to: 'acl' },
      { from: 'acl', to: 'proxy' },
      { from: 'proxy', to: 'sni' },
      { from: 'proxy', to: 'host' },
      { from: 'proxy', to: 'nsn', label: 'connect()' },
    ],
  },
  '06-nsc-client': {
    center: 'nsc',
    nodes: [
      { id: 'nsc', label: 'nsc binary', category: 'component' },
      { id: 'vip', label: 'VIP 127.11.x.x', category: 'data' },
      { id: 'dns', label: 'Local DNS', category: 'data' },
      { id: 'router', label: 'NscRouter', category: 'component' },
      { id: 'httpproxy', label: 'HTTP Proxy', category: 'protocol' },
      { id: 'connector', label: '→ connector', category: 'component', link: '03-data-plane' },
      { id: 'nsd', label: '← 08 NSD', category: 'component', link: '08-nsd-control' },
    ],
    edges: [
      { from: 'nsc', to: 'vip' },
      { from: 'nsc', to: 'dns' },
      { from: 'dns', to: 'router' },
      { from: 'vip', to: 'router' },
      { from: 'router', to: 'connector' },
      { from: 'nsc', to: 'httpproxy' },
      { from: 'nsd', to: 'nsc', dashed: true, label: 'SSE' },
    ],
  },
  '07-nsn-node': {
    center: 'nsn',
    nodes: [
      { id: 'nsn', label: 'nsn binary', category: 'component' },
      { id: 'app', label: 'AppState', category: 'data' },
      { id: 'monitor', label: 'Monitor API<br/>:9090/api/*', category: 'protocol' },
      { id: 'telemetry', label: 'telemetry<br/>OTel + Prom', category: 'component' },
      { id: 'ctrl', label: '← control', category: 'component', link: '02-control-plane' },
      { id: 'dp', label: '← data-plane', category: 'component', link: '03-data-plane' },
      { id: 'proxy', label: '← proxy+acl', category: 'component', link: '05-proxy-acl' },
    ],
    edges: [
      { from: 'ctrl', to: 'app' },
      { from: 'dp', to: 'app' },
      { from: 'proxy', to: 'app' },
      { from: 'app', to: 'nsn' },
      { from: 'nsn', to: 'monitor' },
      { from: 'nsn', to: 'telemetry' },
    ],
  },
  '08-nsd-control': {
    center: 'nsd',
    nodes: [
      { id: 'nsd', label: 'NSD<br/>Control Center', category: 'component' },
      { id: 'auth', label: 'auth<br/>machinekey + JWT', category: 'data' },
      { id: 'reg', label: 'registry<br/>peers + gateways', category: 'data' },
      { id: 'sse', label: 'SSE /api/v1/config/stream', category: 'protocol' },
      { id: 'nsn', label: '→ NSN', category: 'component', link: '07-nsn-node' },
      { id: 'nsgw', label: '→ NSGW', category: 'component', link: '09-nsgw-gateway' },
      { id: 'nsc', label: '→ NSC', category: 'component', link: '06-nsc-client' },
    ],
    edges: [
      { from: 'auth', to: 'nsd' },
      { from: 'reg', to: 'nsd' },
      { from: 'nsd', to: 'sse' },
      { from: 'sse', to: 'nsn', dashed: true },
      { from: 'sse', to: 'nsgw', dashed: true },
      { from: 'sse', to: 'nsc', dashed: true },
    ],
  },
  '09-nsgw-gateway': {
    center: 'nsgw',
    nodes: [
      { id: 'nsgw', label: 'NSGW<br/>traefik + WG + WSS', category: 'component' },
      { id: 'traefik', label: 'traefik<br/>host/SNI route', category: 'protocol' },
      { id: 'wg', label: 'kernel WG<br/>:51820', category: 'protocol' },
      { id: 'wss', label: 'Bun WSS relay', category: 'protocol' },
      { id: 'nsd', label: '← NSD', category: 'component', link: '08-nsd-control' },
      { id: 'nsn', label: '→ NSN', category: 'component', link: '07-nsn-node' },
      { id: 'nsc', label: '← NSC', category: 'component', link: '06-nsc-client' },
    ],
    edges: [
      { from: 'nsd', to: 'nsgw', dashed: true, label: 'SSE' },
      { from: 'nsc', to: 'traefik' },
      { from: 'traefik', to: 'wg' },
      { from: 'traefik', to: 'wss' },
      { from: 'wg', to: 'nsn' },
      { from: 'wss', to: 'nsn' },
      { from: 'nsgw', to: 'traefik' },
      { from: 'nsgw', to: 'wg' },
      { from: 'nsgw', to: 'wss' },
    ],
  },
  '10-nsn-nsc-critique': {
    center: 'critique',
    nodes: [
      { id: 'critique', label: '10 · Critique<br/>70+ findings', category: 'component' },
      { id: 'arch', label: 'architecture-issues', category: 'data' },
      { id: 'func', label: 'functional-gaps', category: 'data' },
      { id: 'fail', label: 'failure-modes', category: 'data' },
      { id: 'perf', label: 'performance-concerns', category: 'data' },
      { id: 'sec', label: 'security-concerns', category: 'data' },
      { id: 'obs', label: 'observability-gaps', category: 'data' },
      { id: 'roadmap', label: 'improvements<br/>+ roadmap', category: 'data' },
      { id: 'nsn', label: '→ 07 NSN', category: 'component', link: '07-nsn-node' },
      { id: 'nsc', label: '→ 06 NSC', category: 'component', link: '06-nsc-client' },
    ],
    edges: [
      { from: 'critique', to: 'arch' },
      { from: 'critique', to: 'func' },
      { from: 'critique', to: 'fail' },
      { from: 'critique', to: 'perf' },
      { from: 'critique', to: 'sec' },
      { from: 'critique', to: 'obs' },
      { from: 'arch', to: 'roadmap' },
      { from: 'func', to: 'roadmap' },
      { from: 'critique', to: 'nsn', dashed: true, label: 'target' },
      { from: 'critique', to: 'nsc', dashed: true, label: 'target' },
    ],
  },
  '11-nsd-nsgw-vision': {
    center: 'vision',
    nodes: [
      { id: 'vision', label: '11 · Vision', category: 'component' },
      { id: 'nsd-cap', label: 'NSD capability<br/>6 axes', category: 'data' },
      { id: 'nsgw-cap', label: 'NSGW capability<br/>6 axes', category: 'data' },
      { id: 'matrix', label: 'feature-matrix<br/>173 rows', category: 'data' },
      { id: 'phase', label: 'Phase 0-3 roadmap', category: 'data' },
      { id: 'ctrl-ext', label: 'control-plane ext', category: 'protocol' },
      { id: 'data-ext', label: 'data-plane ext', category: 'protocol' },
      { id: 'nsd', label: '→ 08 NSD', category: 'component', link: '08-nsd-control' },
      { id: 'nsgw', label: '→ 09 NSGW', category: 'component', link: '09-nsgw-gateway' },
    ],
    edges: [
      { from: 'vision', to: 'nsd-cap' },
      { from: 'vision', to: 'nsgw-cap' },
      { from: 'nsd-cap', to: 'matrix' },
      { from: 'nsgw-cap', to: 'matrix' },
      { from: 'matrix', to: 'phase' },
      { from: 'vision', to: 'ctrl-ext' },
      { from: 'vision', to: 'data-ext' },
      { from: 'ctrl-ext', to: 'nsd', dashed: true },
      { from: 'data-ext', to: 'nsgw', dashed: true },
    ],
  },
};

const CATEGORY_CLASS: Record<NodeCategory, string> = {
  component: 'component',
  protocol: 'protocol',
  data: 'data',
  external: 'external',
};

/**
 * Generate mermaid source for a module's adjacency graph.
 * Returns null if the module has no flow spec.
 */
export function getModuleChart(moduleId: string, basepath: string): string | null {
  const spec = MODULE_FLOWS[moduleId];
  if (!spec)
    return null;
  const b = basepath.replace(/\/$/, '');

  const lines: string[] = [
    'flowchart LR',
    '  classDef component fill:#a7f3d0,stroke:#047857,color:#064e3b;',
    '  classDef protocol fill:#fde68a,stroke:#b45309,color:#78350f;',
    '  classDef data fill:#bfdbfe,stroke:#1d4ed8,color:#1e3a8a;',
    '  classDef external fill:#e9d5ff,stroke:#7e22ce,color:#581c87;',
    '',
  ];

  for (const node of spec.nodes) {
    const safeId = mermaidId(node.id);
    lines.push(`  ${safeId}["${node.label}"]:::${CATEGORY_CLASS[node.category]}`);
  }
  lines.push('');
  for (const edge of spec.edges) {
    const from = mermaidId(edge.from);
    const to = mermaidId(edge.to);
    const arrow = edge.dashed ? '-.->' : '-->';
    if (edge.label)
      lines.push(`  ${from} ${arrow}|${edge.label}| ${to}`);
    else
      lines.push(`  ${from} ${arrow} ${to}`);
  }
  lines.push('');
  for (const node of spec.nodes) {
    if (node.link) {
      lines.push(`  click ${mermaidId(node.id)} href "${b}/modules/${node.link}"`);
    }
  }
  return lines.join('\n');
}

/** Sanitize an id for mermaid (alphanumeric + underscore). */
function mermaidId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '_');
}
