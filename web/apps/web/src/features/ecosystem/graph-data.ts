import type { Edge, Node } from 'reactflow';

export type NodeCategory = 'component' | 'protocol' | 'data' | 'external';

export interface FlowNodeData {
  readonly label: string;
  readonly category: NodeCategory;
  readonly moduleLink?: string;
  readonly sublabel?: string;
}

function n(
  id: string,
  label: string,
  category: NodeCategory,
  x: number,
  y: number,
  moduleLink?: string,
  sublabel?: string,
): Node<FlowNodeData> {
  const data: FlowNodeData = { label, category, moduleLink, sublabel };
  return {
    id,
    type: 'nsioNode',
    position: { x, y },
    data,
    draggable: false,
  };
}

function e(
  id: string,
  source: string,
  target: string,
  label?: string,
  dashed?: boolean,
  animated?: boolean,
): Edge {
  return {
    id,
    source,
    target,
    label,
    animated: animated ?? false,
    style: dashed ? { strokeDasharray: '5 5', stroke: '#8a8f98' } : { stroke: '#6a707a' },
    labelStyle: { fontSize: 10, fill: 'currentColor' },
    labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
    labelBgPadding: [3, 1],
    labelBgBorderRadius: 3,
  };
}

/** NSIO ecosystem overview — 17 nodes / 22 edges. */
export const overviewNodes: Node<FlowNodeData>[] = [
  // external actors
  n('user-app', 'User App', 'external', 20, 320, undefined, 'ssh · curl · psql'),
  n('service-provider', 'Service Provider', 'external', 1520, 320, undefined, 'local · remote'),
  // control plane
  n('nsd-1', 'NSD-1', 'component', 520, 40, '08-nsd-control', 'Control Center'),
  n('nsd-2', 'NSD-2', 'component', 880, 40, '08-nsd-control', 'HA / Multi-Realm'),
  // control-plane transports
  n('noise-quic', 'Noise / QUIC', 'protocol', 260, 160, '02-control-plane', 'anti-DPI'),
  n('sse', 'SSE', 'protocol', 700, 160, '02-control-plane', 'config stream'),
  // bridges
  n('nsgw-1', 'NSGW-1', 'component', 700, 320, '09-nsgw-gateway', 'traefik+WG+WSS'),
  n('nsgw-2', 'NSGW-2', 'component', 700, 500, '09-nsgw-gateway', 'Region 2'),
  // data plane protocols
  n('wg', 'WireGuard', 'protocol', 460, 220, '03-data-plane', 'UDP :51820'),
  n('wss', 'WSS', 'protocol', 460, 420, '03-data-plane', 'TCP :443'),
  // site / user
  n('nsc', 'NSC', 'component', 260, 320, '06-nsc-client', 'User Client'),
  n('nsn', 'NSN', 'component', 1220, 320, '07-nsn-node', 'Site Node · 12 crates'),
  // NSC-local data
  n('vip', 'VIP 127.11.x.x', 'data', 260, 500, '06-nsc-client'),
  n('dns', 'Local DNS', 'data', 40, 500, '06-nsc-client', '*.n.ns'),
  // NSN-internal data
  n('netstack', 'netstack', 'data', 1420, 200, '04-network-stack', 'smoltcp'),
  n('acl', 'ACL', 'data', 1220, 500, '05-proxy-acl', 'allow-only'),
  n('proxy', 'Proxy / NAT', 'data', 1420, 460, '05-proxy-acl', 'Conntrack'),
];

export const overviewEdges: Edge[] = [
  // user path
  e('u-nsc', 'user-app', 'nsc', 'FQDN → VIP'),
  e('nsc-wg', 'nsc', 'wg', 'WG'),
  e('nsc-wss', 'nsc', 'wss', 'WSS fallback', true),
  e('wg-gw1', 'wg', 'nsgw-1'),
  e('wss-gw1', 'wss', 'nsgw-1', undefined, true),
  e('gw1-nsn', 'nsgw-1', 'nsn', 'bridge', false, true),
  e('nsc-gw2', 'nsc', 'nsgw-2', 'alt', true),
  e('gw2-nsn', 'nsgw-2', 'nsn', 'alt region', true),
  // NSN internals
  e('nsn-netstack', 'nsn', 'netstack'),
  e('nsn-acl', 'nsn', 'acl'),
  e('acl-proxy', 'acl', 'proxy'),
  e('netstack-proxy', 'netstack', 'proxy'),
  e('proxy-svc', 'proxy', 'service-provider', 'connect()'),
  // NSC-local
  e('nsc-vip', 'nsc', 'vip', undefined, true),
  e('nsc-dns', 'nsc', 'dns', undefined, true),
  // control plane
  e('nsd1-sse', 'nsd-1', 'sse', undefined, true),
  e('nsd2-sse', 'nsd-2', 'sse', 'HA', true),
  e('sse-nsn', 'sse', 'nsn', 'config push', true),
  e('sse-gw1', 'sse', 'nsgw-1', undefined, true),
  e('nsd1-noise', 'nsd-1', 'noise-quic', undefined, true),
  e('noise-nsc', 'noise-quic', 'nsc', 'config push', true),
  e('sse-nsc', 'sse', 'nsc', undefined, true),
];

// Per-module flow specs (deterministic layout computed at render time)
export interface ModuleFlowSpec {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly category: NodeCategory;
    readonly sublabel?: string;
    readonly link?: string;
  }>;
  readonly edges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly label?: string;
    readonly dashed?: boolean;
  }>;
  readonly center: string;
}

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
      { id: 'common', label: 'common\nmachinekey/peerkey', category: 'data' },
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
      { id: 'connector', label: 'connector\nMultiGW 选路', category: 'component' },
      { id: 'tunnel-wg', label: 'tunnel-wg\ngotatun UAPI', category: 'component' },
      { id: 'tunnel-ws', label: 'tunnel-ws\nWsFrame', category: 'component' },
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
      { id: 'monitor', label: 'Monitor API\n:9090/api/*', category: 'protocol' },
      { id: 'telemetry', label: 'telemetry\nOTel + Prom', category: 'component' },
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
      { id: 'nsd', label: 'NSD\nControl Center', category: 'component' },
      { id: 'auth', label: 'auth\nmachinekey + JWT', category: 'data' },
      { id: 'reg', label: 'registry\npeers + gateways', category: 'data' },
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
      { id: 'nsgw', label: 'NSGW\ntraefik + WG + WSS', category: 'component' },
      { id: 'traefik', label: 'traefik\nhost/SNI route', category: 'protocol' },
      { id: 'wg', label: 'kernel WG\n:51820', category: 'protocol' },
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
      { id: 'critique', label: '10 · Critique\n70+ findings', category: 'component' },
      { id: 'arch', label: 'architecture-issues', category: 'data' },
      { id: 'func', label: 'functional-gaps', category: 'data' },
      { id: 'fail', label: 'failure-modes', category: 'data' },
      { id: 'perf', label: 'performance-concerns', category: 'data' },
      { id: 'sec', label: 'security-concerns', category: 'data' },
      { id: 'obs', label: 'observability-gaps', category: 'data' },
      { id: 'roadmap', label: 'improvements\n+ roadmap', category: 'data' },
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
      { id: 'nsd-cap', label: 'NSD capability\n6 axes', category: 'data' },
      { id: 'nsgw-cap', label: 'NSGW capability\n6 axes', category: 'data' },
      { id: 'matrix', label: 'feature-matrix\n173 rows', category: 'data' },
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

export function getModuleFlow(
  moduleId: string,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } | null {
  const spec = MODULE_FLOWS[moduleId];
  if (!spec)
    return null;

  const ids = spec.nodes.map((x) => x.id);
  const centerId = ids.includes(spec.center) ? spec.center : ids[0];
  if (!centerId)
    return null;

  const others = ids.filter((id) => id !== centerId);
  const nodes: Node<FlowNodeData>[] = [];

  const centerSpec = spec.nodes.find((x) => x.id === centerId)!;
  nodes.push({
    id: centerSpec.id,
    type: 'nsioNode',
    position: { x: 400, y: 280 },
    draggable: false,
    data: {
      label: centerSpec.label,
      category: centerSpec.category,
      sublabel: centerSpec.sublabel,
      moduleLink: centerSpec.link,
    },
  });
  const radius = 230;
  const count = others.length;
  others.forEach((id, i) => {
    const entry = spec.nodes.find((x) => x.id === id)!;
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    nodes.push({
      id,
      type: 'nsioNode',
      position: { x: 400 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius },
      draggable: false,
      data: {
        label: entry.label,
        category: entry.category,
        sublabel: entry.sublabel,
        moduleLink: entry.link,
      },
    });
  });

  const edges: Edge[] = spec.edges.map((edge, i) => ({
    id: `e-${i}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    style: edge.dashed ? { strokeDasharray: '5 5', stroke: '#8a8f98' } : { stroke: '#6a707a' },
    labelStyle: { fontSize: 10, fill: 'currentColor' },
    labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
    labelBgPadding: [3, 1],
    labelBgBorderRadius: 3,
  }));

  return { nodes, edges };
}
