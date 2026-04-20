# NSGW · 数据网关全景

> **NSGW (Network Service Gateway)** —— NSIO 生态的**数据面网关**。它终结 WireGuard UDP、中继 WSS 长连接、通过 traefik 做 HTTPS 反向代理,把 NSD SSE 推送的 `wg_config` / `routing_config` 翻译成 WG peer 表 + traefik 路由表 + WSS 会话。
>
> 本目录是 **NSGW 主题门户**:把分散在 [`docs/09-nsgw-gateway/`](../09-nsgw-gateway/index.md)、[`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 与 [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 中的 NSGW 相关内容(功能 / 缺陷 / 远景 / 路线)汇总到一处,方便按视角查阅。原章节保持不变,本目录是它们的二次组织。

## 1. NSGW 是什么

- **位置**: 数据面网关,通常部署在 PoP / 公有云 region。对外暴露公网 IP,对内与 NSN 用 WG 隧道连接。
- **入站**: `51820/udp` (WireGuard) + `443/tcp` (HTTPS via traefik) + `9443/tcp` mock / `443/wss` prod (WsFrame multiplexed)。
- **出站**: WG 内核接口(`wg0`)解密后把 IP 包送到 NSN 虚拟 IP;WSS `/relay` 的帧转发到"连接器↔客户端"缝合的 NSN 会话;traefik proxy HTTPS 到 `http://<nsn_wg_ip>:<virtual_port>`。
- **控制**: NSD SSE 订阅 `wg_config` / `routing_config` / `acl_projection`;双向握手 `POST /api/v1/machine/register` + `POST /api/v1/gateway/report`。
- **实现**: mock 在 `tests/docker/nsgw-mock/` (Bun/TypeScript);生产参考 `tmp/gateway/` (Go, fosrl/gerbil fork)。**生产 NSGW 本身不在本仓库**——本章关注协议契约与职责边界。

完整组件全景见 [01 · 系统总览](../01-overview/index.md);本门户聚焦 NSGW 视角。

## 2. 四个视角入口

| 文档 | 你想了解 | 主要来源 |
| ---- | -------- | -------- |
| [features.md](./features.md) | NSGW **当前能做什么** —— 三端口入站、WG/WSS/traefik 四条职责、与 NSD 的 SSE 契约、多区域部署形态 | [`docs/09-nsgw-gateway/`](../09-nsgw-gateway/index.md) 7 篇 |
| [bugs.md](./bugs.md) | NSGW **当前有什么坑** —— 与 NSGW 相关的 ARCH/FUNC/FAIL/PERF/SEC 条目 + mock 形态的运营空白 | [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) + [11 · 基线章节](../11-nsd-nsgw-vision/nsgw-capability-model.md#当前坐标-baseline) |
| [vision.md](./vision.md) | NSGW **未来要做什么** —— 六大能力轴 40+ 功能、traefik 去留路线 A/B、数据面协议扩展 | [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) nsgw-capability-model / nsgw-vision |
| [roadmap.md](./roadmap.md) | NSGW 改造**应该按什么顺序**做 —— MVP(对接 SSE 契约)→ GA(多区 + 热升级 + QUIC)→ 企业级(WAF / Anycast / Mesh) | [`docs/11-nsd-nsgw-vision/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md) |

## 3. 一屏速览

| 维度 | 现状 (HEAD 2026-04-20) | 远景 (生产级) |
| ---- | ---------------------- | ------------- |
| 协议 | WG UDP + WSS(WsFrame) + HTTPS(traefik) | + QUIC + Noise + MASQUE/HTTP3 + P2P hole punch + STUN/TURN |
| L4 能力 | SNI 代理(gerbil)+ WSS fallback 直连 | + 任意 TCP/UDP 端口映射(SSH 等)+ IP allow/deny + GeoIP + 连接级 rate-limit |
| L7 能力 | traefik Host 路由(mock)+ PROXY v1(gerbil) | 路线 A:自研轻 Proxy + 外部入口层 · 路线 B:Envoy + xDS;+ WAF + OIDC + Resource auth |
| 控制面契约 | SSE `wg_config` / `routing_config` + `POST /gateway/report` | + `gateway_l4_map` + `gateway_http_config` + `authz` + `billing/ingest` + `ca_bundle_update` |
| 多区域 | 每个 NSGW 独立进程,NSN 侧 `MultiGatewayManager` 选路 | + Anycast IP + GeoDNS + 跨区 failover + Gateway-to-Gateway Mesh |
| 容灾 | `/ready` + `/admin/shutdown`;无热升级 | + graceful drain/swap + 蓝绿 + session 快照 + 跨区 failover + 连接 handoff |
| 安全 | 无 WAF / 无限速 / 无 IP 信誉;ACL 执行在 NSN | + 基础限速 + UDP flood + CrowdSec + WAF + mTLS + 零信任策略点 + DDoS L3-L7 |
| 观测 | `/ready` + `/server-pubkey` + gerbil 带宽/内存/pprof | + Prometheus + OTel traces + 结构化访问日志 + 实时拓扑上报 + 采样控制 |
| 资源 | gerbil `periodicBandwidthCheck` 粗计量 | + 每 peer / 每 org 精确计量 + 配额 + QoS + tc/eBPF 整形 + 计费埋点 |
| 形态 | mock (Bun) 3 文件 + gerbil 生产参考(Go)**未对接 NSIO SSE** | mock + gerbil 合并的**生产级 Go 网关**,消费 NSIO SSE,接入 NSD 管控 |

## 4. 四条核心职责

NSGW 只做这四件事(参见 [09 · responsibilities](../09-nsgw-gateway/responsibilities.md)):

| # | 职责 | 协议 | 代码位置 | 原文 |
| - | ---- | ---- | -------- | ---- |
| ① | **WireGuard UDP 终结** | `51820/udp` kernel WG | `tests/docker/nsgw-mock/src/wg-setup.ts:24` · `tmp/gateway/main.go:327-329` | [09 · responsibilities §①](../09-nsgw-gateway/responsibilities.md#-wireguard-udp-端点mode-3-重-nsc--nsn) |
| ② | **WSS 中继(WsFrame)** | `/relay` + `/client` | `tests/docker/nsgw-mock/src/wss-relay.ts:281-421` | [09 · responsibilities §②](../09-nsgw-gateway/responsibilities.md#-wss-中继mode-2-轻-nsc--nsn-fallback) |
| ③ | **HTTPS 反向代理** | traefik v3 `443/tcp` | `tests/docker/nsgw-mock/src/traefik-config.ts:32-68` | [09 · responsibilities §③](../09-nsgw-gateway/responsibilities.md#-https-反向代理mode-1-无-nsc-的浏览器直连) |
| ④ | **与 NSD 注册表同步** | `POST /register` + `POST /gateway/report` + SSE 订阅 | `tests/docker/nsgw-mock/src/index.ts:300-370` | [09 · responsibilities §④](../09-nsgw-gateway/responsibilities.md#-与-nsd-的注册表同步) |
| ⑤ | **`/client` ingress 的 ACL 预过滤** | 两级信任的前一级 | `acl_projection` SSE 事件 + JWT 校验 | [09 · responsibilities §⑤](../09-nsgw-gateway/responsibilities.md#-client-ingress-的-acl-预过滤两级信任的前一级) |

NSGW **不做**:认证(NSD 职责)、策略合并(NSN 的 `MultiControlPlane`)、权威 ACL(NSN 终决)、TCP 状态机(traefik 或字节中继)、虚拟 IP 分配(NSC / NSD)。

## 5. 六大能力轴(生产化视角)

来自 [11 · nsgw-capability-model](../11-nsd-nsgw-vision/nsgw-capability-model.md):

| 轴 | 主问题 | 当前覆盖 | MVP / GA / 企业级 |
| -- | ------ | -------- | ----------------- |
| ① 连接(Transport) | NSC/NSN 用什么协议接入 | WG + WSS + traefik TLS | 🟢 🟢 🟢 |
| ② 路由(Routing) | 流量送到哪个 NSN | WG AllowedIPs + traefik Host + gerbil SNI | 🟢 🟢 🟢 |
| ③ 安全(Security) | 挡恶意流量、限合法流量 | 基本 TLS + 可选 PROXY v1 | 🟡 🟢 🟢 |
| ④ 容灾(Resilience) | 网关挂了 / 升级 / 回滚 | `/ready` + `/admin/shutdown` | 🟡 🟢 🟢 |
| ⑤ 观测(Telemetry) | 每连接发生什么 | gerbil 带宽 + 内存 + pprof | 🟡 🟢 🟢 |
| ⑥ 资源(Resource) | 承载多少 / 公平 / 计费 | gerbil `periodicBandwidthCheck` 粗计量 | 🔴 🟢 🟢 |

## 6. 部署形态分层

| 形态 | 说明 | 代码/文档 |
| ---- | ---- | --------- |
| **mock (Bun + TS)** | E2E 测试专用;3 文件 387 行;traefik + kernel WG + 会话缝合 | `tests/docker/nsgw-mock/` |
| **生产参考 (Go, gerbil fork)** | 功能远超 mock;kernel WG (wgctrl) + SNI 代理 + UDP hole punch + PROXY v1 + bandwidth report | `tmp/gateway/main.go:1-1317` |
| **生产 NSGW(预期)** | mock 的 SSE 契约 + gerbil 的数据面能力并集;**目前两者独立未融合** | 本章 roadmap 规划 |

## 7. 本门户与原章节的关系

- **不复制内容,做组织**:本目录里所有详细描述都链接回原章节,条目均带 `path:line` 锚点。
- **不删除原章节**:`docs/09` 是 NSGW 契约权威,`docs/11` 是生产化愿景,都被其他章节交叉引用,移动会破坏链接。
- **更新策略**:原章节内容更新时,本门户的"摘要 / 索引 / 路线"需要相应同步;缺陷修复后在 [bugs.md](./bugs.md) 标 `[RESOLVED in <hash>]`。

## 8. 推荐阅读顺序

1. **第一次接触 NSGW** → [features.md §1 部署形态](./features.md#1-部署形态) → [features.md §2 四条核心职责](./features.md#2-四条核心职责)
2. **要部署 NSGW** → [features.md §5 与 NSD 的注册表同步](./features.md#5-与-nsd-的注册表同步) → [features.md §6 多区域部署](./features.md#6-多区域部署)
3. **要评估生产差距** → [bugs.md §1 P0/P1 必修](./bugs.md#1-p0--p1-必修) → [bugs.md §2 运营空白](./bugs.md#2-运营空白从-mock--生产的工程差距)
4. **要规划演进** → [vision.md §1 路线 A vs B 决策](./vision.md#1-架构再审视--traefik-是否继续) → [vision.md §2-7 六大能力轴](./vision.md#2-轴--连接能力-transport)
5. **要排期** → [roadmap.md §2 MVP 清单](./roadmap.md#2-phase-1--mvp) → [roadmap.md §3 GA](./roadmap.md#3-phase-2--ga) → [roadmap.md §4 企业级](./roadmap.md#4-phase-3--企业级)
