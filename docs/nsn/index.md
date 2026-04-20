# NSN · 站点节点全景

> **NSN (Network Site Node)** —— NSIO 生态在站点侧的运行时进程。它把 NSD 下发的策略落地为本机的 WireGuard 隧道、本地路由 / NAT、Proxy / ACL 与监控 API,把对端 (NSC / 远端 NSN) 的流量代理到本地或远程服务。
>
> 本目录是 **NSN 主题门户**:把分散在 `docs/07-nsn-node`、`docs/10-nsn-nsc-critique`、`docs/11-nsd-nsgw-vision` 中的 NSN 相关内容(功能 / 缺陷 / 远景 / 路线)汇总到一处,方便按视角查阅。原章节保持不变,本目录是它们的二次组织。

## 1. NSN 是什么

- **位置**: 站点侧(企业内网 / 数据中心 / 边缘节点)。和用户侧的 NSC (`docs/06-nsc-client/`) 对称,但承担的是"被访问端"职责。
- **入站**: 通过 control 面 (SSE / Noise / QUIC) 从一个或多个 NSD 拉取 `wg / proxy / acl / gateway / routing / dns` 配置;通过 data 面 (`tunnel-wg` UDP 或 `tunnel-ws` WSS) 接受来自 NSGW 的中继流量。
- **出站**: 把解密后的 TCP / UDP 交给 `netstack` (smoltcp) → `nat::ServiceRouter` → `proxy`,代理到 **本地服务** (`127.0.0.1:*`) 或 **远程服务** (LAN IP / 域名)。
- **观测**: 默认在 `127.0.0.1:9090` 暴露只读 JSON + Prometheus 文本端点。
- **代码**: `crates/nsn/` (1627 行 main.rs + state/health/monitor/validator) + `crates/telemetry/`。

完整组件全景见 [01 · 系统总览](../01-overview/index.md);本门户聚焦 NSN 视角。

## 2. 三个视角入口

| 文档 | 你想了解 | 主要来源 |
| ---- | -------- | -------- |
| [features.md](./features.md) | NSN **当前能做什么** —— 二进制、CLI、配置分层、生命周期、配置热更新、Monitor API、telemetry | [`docs/07-nsn-node/`](../07-nsn-node/index.md) 7 篇 |
| [bugs.md](./bugs.md) | NSN **当前有什么坑** —— 70+ 缺陷中与 NSN 相关的 Top 项,按 ARCH / FUNC / FAIL / PERF / OBS / SEC 分类 | [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 6 大缺陷文档 |
| [vision.md](./vision.md) | NSN **未来要做什么** —— 跨组件演进里 NSN 承担的新形态(edge NSN / 移动 NSN / P2P / 多路径 / 私有 DNS / BYO-CA) | [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) data-plane / control-plane extensions |
| [roadmap.md](./roadmap.md) | NSN 改造**应该按什么顺序**做 —— Phase 0 紧急止血 → Phase 1-7 的依赖与协调点 | [`docs/10-nsn-nsc-critique/roadmap.md`](../10-nsn-nsc-critique/roadmap.md) + [`docs/11-nsd-nsgw-vision/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md) |

## 3. 一屏速览

| 维度 | 现状 (HEAD 2026-04-16) | 远景 (生产级) |
| ---- | ---------------------- | ------------- |
| 数据面模式 | WG/TUN, WG/UserSpace, WSS fallback | + P2P 直连, + MPTCP / 多路径, + BBR, + FEC |
| 控制面 | SSE / Noise / QUIC 三传输,4 个 HTTP API 旁路 (`auth/register/heartbeat`) | 全部封装进 ControlTransport,加密信封统一 |
| ACL 评估 | 两份独立 `Arc<AclEngine>`、本地 fail-OPEN / WSS fail-CLOSED | 单一 `ArcSwap<AclEngine>`,fail-CLOSED 默认 |
| 多 NSD 合并 | wg/proxy 并集,**acl 交集**(任一空 → 清空)`[已决议改并集]` | 并集 + 本地 ACL 保底 + sentinel 区分"空"vs"失败" |
| 可观测性 | OTel pipeline 注册但**无 instrument**;7 行 `format!()` 拼 metric | 全 OTel + histogram + spawn panic counter + tracing span |
| NAT 表 | `ConntrackTable` 无 GC / TTL / cap (P0 OOM) | TTL+cap+cleanup task + evictions counter |
| 边缘部署 | 不支持无头 provisioning | provisioning key 自动注册 + edge 缓存/计算 |
| IPv6 | 全栈 v4-only | 待立项(~15 人日) |

## 4. 关键文件 (NSN 源码地图)

| 文件 | 行数 | 职责 |
| ---- | ---- | ---- |
| `crates/nsn/src/main.rs` | 1627 | CLI 解析、`run()` 装配、启动顺序编排 |
| `crates/nsn/src/state.rs` | 660 | `AppState` / `GatewayState` / `TunnelMetrics` / `ConnectionTracker` / `AclState` |
| `crates/nsn/src/monitor.rs` | 430 | Axum 只读 JSON + Prometheus 文本 handler |
| `crates/nsn/src/validator.rs` | 331 | 服务端 proxy 规则 vs 本地 `services.toml` 白名单对账 |
| `crates/nsn/src/health.rs` | 121 | `/healthz` 简化存活探针 |
| `crates/telemetry/src/lib.rs` | 51 | OTel MeterProvider + Prometheus Registry 装配 |
| `crates/telemetry/src/metrics.rs` | 115 | `ProxyMetrics` / `TunnelMetrics` 原子计数器结构 |

## 5. 本门户与原章节的关系

- **不复制内容,做组织**:本目录里所有详细描述都链接回原章节,缺陷 / 远景条目均带 `path:line` 锚点。
- **不删除原章节**:`docs/01-09` / `docs/10` / `docs/11` 都被其他章节交叉引用,移动会破坏链接。
- **更新策略**:原章节内容更新时,本门户的"摘要 / 索引 / 路线"需要相应同步;缺陷修复后在 [bugs.md](./bugs.md) 标 `[RESOLVED in <hash>]`。

## 6. 推荐阅读顺序

1. **第一次接触 NSN** → [features.md §1 二进制与运行形态](./features.md#1-二进制与运行形态)
2. **要部署 NSN** → [features.md §3 CLI 与配置分层](./features.md#3-cli-与配置分层) → [features.md §5 监控 API](./features.md#5-监控-api-与-telemetry)
3. **要评估生产风险** → [bugs.md §1 P0 必修](./bugs.md#1-p0-必修8-项)
4. **要规划演进** → [vision.md](./vision.md) → [roadmap.md](./roadmap.md)
5. **要排修复优先级** → [roadmap.md §2 Phase 拆解](./roadmap.md#2-phase-拆解)
