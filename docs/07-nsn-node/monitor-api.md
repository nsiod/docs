# Monitor API: HTTP 端点 / GatewayEvent

> 源码:
> - handler: [`crates/nsn/src/monitor.rs`](../../../nsio/crates/nsn/src/monitor.rs) / [`health.rs`](../../../nsio/crates/nsn/src/health.rs)
> - router 装配: [`crates/nsn/src/main.rs:529-559`](../../../nsio/crates/nsn/src/main.rs)
> - `GatewayEvent`: [`crates/connector/src/multi.rs:24`](../../../nsio/crates/connector/src/multi.rs)
> - 事件消费: [`main.rs:632-640` + `apply_gateway_event`](../../../nsio/crates/nsn/src/main.rs)

本文档是 nsn 监控面的契约参考。所有端点 **只读**，默认绑定 `127.0.0.1:9090`。

## 1. 端点概览

| Path | Method | 响应类型 | 简介 | Handler |
| ---- | ------ | -------- | ---- | ------- |
| `/healthz` | GET | JSON | 存活探针 + per-endpoint 连通性 | [`health::healthz`](../../../nsio/crates/nsn/src/health.rs) |
| `/api/status` | GET | JSON | 全局一屏概览 | [`monitor::status`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/node` | GET | JSON | 节点身份 + SystemInfo | [`monitor::node`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/gateways` | GET | JSON | 每网关连接 / 字节 / 握手 | [`monitor::gateways`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/control-planes` | GET | JSON | 每 NSD 连接状态 | [`monitor::control_planes`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/tunnels` | GET | JSON | 每网关 WG 隧道度量 | [`monitor::tunnels`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/services` | GET | JSON | 本地服务白名单 (含 disabled) | [`monitor::services`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/acl` | GET | JSON | ACL policy 摘要 + 最近拒绝 | [`monitor::acl`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/nat` | GET | JSON | NAT 表统计 | [`monitor::nat`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/connections` | GET | JSON | 活跃 / 总 / per-proto / per-service 连接 | [`monitor::connections`](../../../nsio/crates/nsn/src/monitor.rs) |
| `/api/metrics` | GET | Prometheus text | OTel + `nsn_*` 汇总指标 | [`monitor::metrics_prometheus`](../../../nsio/crates/nsn/src/monitor.rs) |

路由装配: [`main.rs:533-545`](../../../nsio/crates/nsn/src/main.rs)。

### 1.1 绑定与安全

- 默认 `--monitor-addr 127.0.0.1:9090` ([`main.rs:85`](../../../nsio/crates/nsn/src/main.rs))。
- 全部端点无鉴权；外部暴露需要自行加反向代理 / mTLS。
- bind 失败只 `tracing::warn!` ([`main.rs:555`](../../../nsio/crates/nsn/src/main.rs))，不会令 nsn 退出。

## 2. 端点详解

### 2.1 `GET /healthz`

`HealthResponse` ([`health.rs:56`](../../../nsio/crates/nsn/src/health.rs)):

| 字段 | 类型 | 示例 | 说明 |
| ---- | ---- | ---- | ---- |
| `wg_connected` | bool | `true` | WireGuard UDP 隧道是否就绪 |
| `wss_connected` | bool | `false` | WSS 隧道是否就绪 |
| `transport` | `"udp"` / `"wss"` / `"connecting"` | `"udp"` | 当前活跃 transport |
| `uptime_secs` | u64 | `3600` | 进程 uptime |
| `services_count` | usize | `4` | 已启用服务数 |
| `strict_mode` | bool | `true` | services.toml 是否严格模式 |
| `data_plane` | string | `"userspace"` | 数据面 (`userspace` / `tun` / `wss`) |
| `control_centers[]` | array | — | 每 NSD 的 `{id, connected, latency_ms?}` |
| `gateways[]` | array | — | 每网关的 `{id, connected, transport?, latency_ms?, disabled}` |

**使用场景**

- systemd `Restart=on-failure` + 外部探针
- k8s liveness / readiness
- E2E 启动就绪等待

### 2.2 `GET /api/status`

全局概览 ([`monitor.rs:21`](../../../nsio/crates/nsn/src/monitor.rs)):

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `version` | string | `CARGO_PKG_VERSION` |
| `uptime_seconds` | u64 | 进程 uptime |
| `transport_mode` | string | CLI/配置的 `auto`/`udp`/`wss` |
| `active_transport` | string | 运行时活跃 transport |
| `gateways_connected` / `gateways_total` | usize | 网关连通统计 |
| `control_planes_connected` | usize | NSD 连通数 |
| `services_count` / `services_strict` | — | 同 `/healthz` |
| `active_connections` | u64 | 活跃代理连接 |
| `nat_entries` | u64 | NAT 活跃映射 |
| `acl_rules` | usize | ACL 已加载规则数 |
| `bytes_tx` / `bytes_rx` | u64 | 累计字节 |

**使用场景**: 运维 dashboard 一屏概览。

### 2.3 `GET /api/node`

`NodeResponse` ([`monitor.rs:73`](../../../nsio/crates/nsn/src/monitor.rs)) = `NodeInfo` + `SystemInfo`:

```json
{
  "machine_id": "ab3xk9mnpq",
  "machine_key_pub": "hex(32B)",
  "peer_key_pub": "hex(32B)",
  "hostname": "site-1",
  "os": "linux",
  "version": "0.7.0",
  "registered": true,
  "state_dir": "/var/lib/nsio",
  "system_info": {
    "hostname": "site-1", "os": "linux", "os_version": "Debian 12",
    "arch": "x86_64", "kernel": "6.1.0-43-amd64",
    "nsn_version": "0.7.0", "data_plane": "userspace",
    "uptime_secs": 3600, "local_ips": ["10.1.2.3"],
    "cpu_count": 4, "memory_total_mb": 8192
  }
}
```

- **永远不包含私钥** —— `NodeInfo` 仅含公钥。
- `uptime_secs` 在 handler 内实时重算 ([`monitor.rs:82`](../../../nsio/crates/nsn/src/monitor.rs))。

### 2.4 `GET /api/gateways`

每网关记录 (`GatewayState` flatten + `connected` bool):

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 网关 ID (`gw-1` / NSGW site 名) |
| `endpoint` | string | 当前使用的 `host:port` 或 `wss://...` |
| `status` | string | `pending` / `connecting` / `connected` / `reconnecting` / `disconnected` / `disabled` |
| `transport` | string | `udp` / `wss` |
| `latency_ms?` | u64 | 握手 RTT |
| `connected_since?` | RFC3339 | 最近一次 connected 起始时间 |
| `bytes_tx` / `bytes_rx` | u64 | 该网关累计字节 (WG 模式由 `gw_status_rx` 注入) |
| `last_handshake?` | RFC3339 | WG 最近握手时间 |
| `reconnect_attempt?` | u32 | 重连尝试计数 |
| `last_error?` | string | 最后一次失败原因 |
| `connected` | bool | `status == "connected"` 派生字段 |

### 2.5 `GET /api/control-planes`

每 NSD: `{id, url, status, connected_since?, last_wg_config?, last_proxy_config?, last_acl_policy?, last_ping?}` ([`state.rs:82`](../../../nsio/crates/nsn/src/state.rs))。

- `status` 初值 `"connecting"` ([`main.rs:648`](../../../nsio/crates/nsn/src/main.rs))；`mark_control_plane_connected` 把 `last_ping` 与 `connected_since` 都刷成 `now_rfc3339()`。

### 2.6 `GET /api/tunnels`

每网关的 `TunnelMetrics` ([`state.rs:101`](../../../nsio/crates/nsn/src/state.rs)):

```json
{
  "tunnels": [{
    "gateway_id": "gw-1",
    "peer_public_key": "hex(32B)",
    "endpoint": "nsgw-1:51820",
    "virtual_ip": "100.64.1.1",
    "handshakes": 120,
    "last_handshake": "2026-04-16T10:22:00Z",
    "bytes_tx": 1048576,
    "bytes_rx": 2097152,
    "keepalive_interval": 25
  }]
}
```

- 仅在 WG 模式下有条目；WSS 模式下 `tunnel_metrics` 保持为空。
- 数据源: `gw_status_rx` 循环 [`main.rs:967-989`](../../../nsio/crates/nsn/src/main.rs)。

### 2.7 `GET /api/services`

见 [services-report.md#monitor-api-apiservices](./services-report.md#6-monitor-api-apiservices)。

### 2.8 `GET /api/acl`

```json
{
  "loaded": true,
  "last_loaded": "2026-04-16T10:00:00Z",
  "rule_count": 12,
  "host_aliases": 3,
  "default_action": "deny",
  "recent_denials": [
    {"timestamp":"2026-04-16T10:05:12Z","src_ip":"10.0.0.5","dst":"192.168.1.50:22","protocol":"tcp","reason":"no match"}
  ]
}
```

- `recent_denials` 是长度 ≤ 100 的 ring buffer ([`state.rs:22`](../../../nsio/crates/nsn/src/state.rs))。
- ACL 未下发时 `loaded=false`, `rule_count=0`, `default_action="deny"` (fail-closed)。

### 2.9 `GET /api/nat`

NAT 引擎的 atomic 快照:

```json
{
  "active_entries": 128,
  "total_created": 5021,
  "total_expired": 4893,
  "rules_loaded": 14
}
```

字段对应 `NatStats` ([`state.rs:117`](../../../nsio/crates/nsn/src/state.rs))。

### 2.10 `GET /api/connections`

```json
{
  "active": 3,
  "total": 128,
  "by_protocol": {"tcp": 2, "udp": 1},
  "by_service":  {"web.ab3xk9mnpq.n.ns": 2, "db.ab3xk9mnpq.n.ns": 1},
  "connections": [/* ConnectionRecord[] ring buffer，最多 500 条 */]
}
```

- 活跃 / 总数来自 `ConnectionTracker` ([`state.rs:193`](../../../nsio/crates/nsn/src/state.rs))。
- WSS 模式下由 `WssConnectionEvent` (`Open` / `Close`) 驱动 ([`main.rs:760-788`](../../../nsio/crates/nsn/src/main.rs))。

### 2.11 `GET /api/metrics` (Prometheus)

见 [telemetry.md](./telemetry.md#4-prometheus-暴露--apimetrics)。响应 `Content-Type: text/plain; version=0.0.4; charset=utf-8` ([`monitor.rs:371-373`](../../../nsio/crates/nsn/src/monitor.rs))。

## 3. GatewayEvent: 实时事件通道

`GatewayEvent` ([`connector/src/multi.rs:24`](../../../nsio/crates/connector/src/multi.rs)) 是连接层和 AppState 之间的 **唯一写接口**，在 nsn 内经由 `tokio::mpsc::channel::<GatewayEvent>(64)` 传递。

### 3.1 事件类型

| 变体 | 字段 | 产生点 | 消费效果 (→ `AppState`) |
| ---- | ---- | ------ | ---------------------- |
| `Connected { id, transport, latency }` | 连接成功 | `MultiGatewayManager::mark_connected` ([`multi.rs:210`](../../../nsio/crates/connector/src/multi.rs)) | `status="connected"`, `transport=<...>`, `connected_since=now`, `latency_ms?`, 清空 `last_error` / `reconnect_attempt` |
| `Disconnected { id, error }` | 连接丢失 | `mark_failed` ([`multi.rs:228`](../../../nsio/crates/connector/src/multi.rs)) | `status="disconnected"`, `connected_since=None`, `last_error=<err>` |
| `Reconnecting { id, attempt }` | 尝试重连 | `mark_reconnecting` ([`multi.rs:248`](../../../nsio/crates/connector/src/multi.rs)) | `status="reconnecting"`, `reconnect_attempt=<n>` |
| `LatencyUpdate { id, latency }` | 延迟刷新 | probe ([`multi.rs:264`](../../../nsio/crates/connector/src/multi.rs)) | `latency_ms=<ms>` |
| `BytesTransferred { id, tx, rx }` | WG 字节计数 tick | `gw_status_rx` 循环 ([`main.rs:960`](../../../nsio/crates/nsn/src/main.rs)) | `bytes_tx / bytes_rx` 替换 (累计值) |
| `HandshakeCompleted { id, timestamp }` | WG 新握手 | 同上循环检测 `handshake_count` 增长 ([`main.rs:948`](../../../nsio/crates/nsn/src/main.rs)) | `last_handshake=rfc3339(timestamp)` |

枚举定义原文:

```rust
pub enum GatewayEvent {
    Connected { id: String, transport: String, latency: Option<Duration> },
    Disconnected { id: String, error: Option<String> },
    Reconnecting { id: String, attempt: u32 },
    LatencyUpdate { id: String, latency: Duration },
    BytesTransferred { id: String, tx: u64, rx: u64 },
    HandshakeCompleted { id: String, timestamp: u64 },
}
```

### 3.2 订阅链路

[GatewayEvent 订阅链路](./diagrams/gateway-event-subscribe.d2)

对应 `apply_gateway_event` 实现 [`main.rs:1062-1110`](../../../nsio/crates/nsn/src/main.rs)。

完整数据流图：[`diagrams/health-flow.d2`](./diagrams/health-flow.d2)。

### 3.3 通道容量

- `GatewayEvent` channel: **64** ([`main.rs:629`](../../../nsio/crates/nsn/src/main.rs))。生产速率 ≪ 64/tick，`try_send` 失败只 drop 当前事件 ([`main.rs:960`](../../../nsio/crates/nsn/src/main.rs))。
- `WssConnectionEvent` channel: **128** ([`main.rs:760`](../../../nsio/crates/nsn/src/main.rs))。
- `GatewayStatusUpdate` channel (tunnel-wg 内部): **16** ([`main.rs:900`](../../../nsio/crates/nsn/src/main.rs))。

## 4. 消费示例

```bash
curl -s http://127.0.0.1:9090/healthz | jq
curl -s http://127.0.0.1:9090/api/status | jq
curl -s http://127.0.0.1:9090/api/gateways | jq '.gateways[] | {id, status, latency_ms, bytes_tx}'
curl -s http://127.0.0.1:9090/api/metrics | grep '^nsn_' | head
```

对于自动化测试，`/api/status` 的 `control_planes_connected > 0` + `gateways_connected > 0` 可作为稳定的就绪信号。

## 5. 字段稳定性承诺

- `/healthz` 响应与 MON-001 初版兼容 —— `wg_connected` / `wss_connected` / `transport` / `uptime_secs` / `services_count` / `strict_mode` 始终存在 ([`health.rs:9-22` 文档注释](../../../nsio/crates/nsn/src/health.rs))。
- `/api/*` 新增字段都使用 `skip_serializing_if = "Option::is_none"` 或 `skip_serializing_if = "std::ops::Not::not"` 来避免破坏现有消费者。示例: `GatewayHealth::disabled` ([`health.rs:50-51`](../../../nsio/crates/nsn/src/health.rs))。

## 6. 相关文档

- [health-monitor.md](./health-monitor.md) — handler 与 state 内部结构
- [lifecycle.md](./lifecycle.md) — Monitor 何时启动
- [telemetry.md](./telemetry.md) — `/api/metrics` 细节
- [services-report.md](./services-report.md) — `/api/services` 的契约
