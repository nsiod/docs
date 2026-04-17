# 07. NSN 站点节点与观测 (nsn + telemetry)

本模块说明 **nsn** 二进制的启动、组装方式，以及它对外暴露的 **本地监控 API** 与 **Prometheus 指标**。

NSN (Network Site Node) 是 NSIO 生态中位于 **站点侧** 的运行时进程：

- 通过 **control 面** (SSE / Noise / QUIC) 从 NSD 拉取配置 (wg / proxy / acl / gateway / routing / dns)。
- 通过 **data 面** (tunnel-wg UDP 或 tunnel-ws WSS) 连接 NSGW。
- 把 解密后的 TCP / UDP 流量交给 `netstack` (smoltcp) → `nat::ServiceRouter` → `proxy`，最终代理到 **本地服务** (`127.0.0.1:*`) 或 **远程服务** (LAN IP / 域名)。
- 在 `127.0.0.1:9090` 暴露只读监控 API 与 Prometheus 端点。

## 工作目录与源码

- 二进制: `/app/ai/nsio/crates/nsn/`  (`main.rs` / `health.rs` / `monitor.rs` / `state.rs` / `validator.rs`)
- 观测: `/app/ai/nsio/crates/telemetry/`  (`lib.rs` / `metrics.rs`)

## 文档索引

| 文档 | 主题 |
| ---- | ---- |
| [nsn-binary.md](./nsn-binary.md) | nsn 二进制: `main` / CLI / 配置分层 / 模块装配 |
| [lifecycle.md](./lifecycle.md) | 启动顺序 / 配置流 / 优雅关停 |
| [health-monitor.md](./health-monitor.md) | `health` / `monitor` / `validator` / `state` 的职责边界 |
| [services-report.md](./services-report.md) | `services.toml` → `ServiceReport` → NSD |
| [telemetry.md](./telemetry.md) | `telemetry` crate: OpenTelemetry + Prometheus |
| [monitor-api.md](./monitor-api.md) | HTTP 端点表、`GatewayEvent` 订阅链路 |

## 关联模块

- [01. Overview](../01-overview/) — 生态与组件职责边界
- [02. Control Plane](../02-control-plane/) — NSD 配置下发、SSE/Noise/QUIC 传输
- [03. Data Plane](../03-data-plane/) — tunnel-wg / tunnel-ws / connector 回退
- [04. Network Stack](../04-network-stack/) — smoltcp / TUN / NetStack
- [05. Proxy & ACL](../05-proxy-acl/) — ACL 引擎、ServiceRouter、NAT
- [06. NSC Client](../06-nsc-client/) — 用户侧客户端 (参照节点)

## 图索引

[NSN 组件概览](./diagrams/nsn-overview.d2)

- [diagrams/nsn-startup.d2](./diagrams/nsn-startup.d2) — 启动时序图
- [diagrams/nsn-modules.d2](./diagrams/nsn-modules.d2) — 模块装配关系图
- [diagrams/health-flow.d2](./diagrams/health-flow.d2) — `GatewayEvent` → `AppState` → API 数据流
- [diagrams/metrics.d2](./diagrams/metrics.d2) — Metrics 采集与暴露

## 关键源文件

| 文件 | 行数 | 职责 |
| ---- | ---- | ---- |
| `crates/nsn/src/main.rs` | 1627 | CLI 解析、`run()` 装配、启动顺序编排 |
| `crates/nsn/src/state.rs` | 660 | `AppState` 共享状态、`GatewayState` / `TunnelMetrics` / `ConnectionTracker` / `AclState` |
| `crates/nsn/src/monitor.rs` | 430 | Axum 只读 JSON + Prometheus 文本 handler |
| `crates/nsn/src/validator.rs` | 331 | 服务端 proxy 规则 vs 本地 `services.toml` 白名单对账 |
| `crates/nsn/src/health.rs` | 121 | `/healthz` 简化存活探针 |
| `crates/telemetry/src/lib.rs` | 51 | OTel MeterProvider + Prometheus Registry 装配 |
| `crates/telemetry/src/metrics.rs` | 115 | `ProxyMetrics` / `TunnelMetrics` 原子计数器结构 |
