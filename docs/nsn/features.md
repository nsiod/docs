# NSN · 功能全景

> 本页是 NSN **当前实现**的精简索引。详细描述请到 [`docs/07-nsn-node/`](../07-nsn-node/index.md) 7 篇原文档。
>
> 数据基于 HEAD 2026-04-16(18,037 行 Rust,12 crate)。

## 1. 二进制与运行形态

| 项 | 现状 |
| --- | --- |
| 二进制 | `crates/nsn/` 单一可执行 (1627 行 `main.rs` + state/health/monitor/validator) |
| 安全 | `#![forbid(unsafe_code)]` 全程禁用 unsafe |
| 异步运行时 | `tokio` 多线程 |
| 默认数据面 | `userspace` (gotatun + smoltcp);可切 `tun` (root + 内核 TUN) 或 `wss` (纯 WebSocket relay) |
| 默认控制面 | `sse` (HTTP/1.1 over rustls);可切 `noise` (Noise_IK over TCP) 或 `quic` (pubkey-pinned QUIC) |
| 监控端口 | `127.0.0.1:9090` (默认绑定 loopback,不开 auth) |
| 优雅关停 | `Ctrl-C` / `SIGTERM` → `shutdown_signal()` → runtime drop |
| 日志 | tracing JSON 按日滚动到 `--log-dir` |

详见 → [07 · nsn-binary.md](../07-nsn-node/nsn-binary.md)

## 2. 模块装配 (`run()` 14 阶段)

```
A. 发现 NSD / per-realm 注册        →  HashMap<nsd_id, MachineState>
B. 心跳客户端                       →  Vec<HeartbeatClient>
C. 加载 services.toml               →  ServicesConfig
D. 构造 AppState                    →  Arc<AppState>
E. 启动 Monitor API (axum)          →  9 条 /api/* + /healthz + /api/metrics
F. 启动 MultiControlPlane           →  9 条 config 接收 task
G. 60s 心跳                         →  POST /api/v1/machine/heartbeat
H. MultiGatewayManager + GatewayEvent drain
I. 构造 ServiceRouter               →  本地服务查表 + ACL 入口
J. 等待首份 ACL / WgConfig / GatewayConfig
K. ConnectorManager::connect        →  根据 transport_mode 选 UDP / WSS
L. WG 分支: TunnelManager + NetStack + relay
M. WSS 分支: transport.run()
N. 等 Ctrl-C / SIGTERM
```

源码 [`crates/nsn/src/main.rs:310-1054`](https://github.com/nsiod/nsio/blob/main/crates/nsn/src/main.rs#L310);时序图 [`07/diagrams/nsn-startup-compact.d2`](../07-nsn-node/diagrams/nsn-startup-compact.d2)。

## 3. CLI 与配置分层

CLI 标志(节选,完整表见 [07 · nsn-binary.md §2](../07-nsn-node/nsn-binary.md#2-cli-标志)):

| 标志 / 环境变量 | 作用 |
| --- | --- |
| `--auth-key <k>` 或 `<realm>=<k>` / `AUTH_KEY` | 首次注册的一次性 key,支持多 realm |
| `--machine-id` / `MACHINE_ID` | 无状态模式下的固定设备 ID |
| `--device-flow` / `DEVICE_FLOW` | OAuth2 device authorization 注册 |
| `--state-dir` / `STATE_DIR` | 机器状态目录 (默认 `/var/lib/nsio`) |
| `--server-url` / `SERVER_URL` | 主 NSD URL |
| `--config-file` / `CONFIG_FILE` | TOML 配置文件路径 |
| `--monitor-addr` / `MONITOR_ADDR` | 监控 HTTP 绑定地址,默认 `127.0.0.1:9090` |
| `--transport-mode` | `auto` / `udp` / `wss` |
| `--services-file` / `SERVICES_FILE` | 本地服务白名单 TOML |
| `--data-plane` / `DATA_PLANE` | `userspace` / `tun` / `wss` |
| `--control-mode` / `CONTROL_MODE` | `sse` / `noise` / `quic` |
| `--nsd-pubkey` / `NSD_PUBKEY` | Noise/QUIC 所需 NSD X25519 公钥 (32 字节 hex) |
| `--snat-addr` / `SNAT_ADDR` | 远程服务回包的 SNAT 源 IP |
| `--permissive` | 关闭严格 service 校验(仅 dev / test) |

配置分层(`figment`):**defaults → TOML → env → CLI**,详见 [07 · nsn-binary.md §3](../07-nsn-node/nsn-binary.md#3-配置分层-figment)。

## 4. 生命周期与配置热更新

`MultiControlPlane::new` 返回 8 个 `mpsc::Receiver`,每一类对应 NSD 的一种推送:

| Channel | 消费者 | 作用 |
| --- | --- | --- |
| `wg_config_rx` | `TunnelManager` | WireGuard peer / allowed_ips 热替换 |
| `proxy_config_rx` | `validator::find_violations` + log | NSD→NSN 代理规则白名单对账 |
| `acl_config_rx` | `router.load_acl` + `acl_handle` | ACL 引擎热更新 + `AppState.acl_state` |
| `gateway_config_rx` | `record_gateway_config` + `transport.set_wss_relay_url` | 网关拓扑更新 |
| `routing_config_rx` | `app_state.routing_config = Some(cfg)` | DNS / 路由表 |
| `dns_config_rx` | `app_state.dns_config = Some(cfg)` | 全局 DNS 记录 |
| `control_status_rx` | `app_state.mark_control_plane_connected` | 控制面连通事件 |
| `token_refresh_rx` | `transport.set_token_refresh_rx` | WSS session token 刷新 |

启动顺序的关键约束:

1. **先 Monitor 后控制面** — `/healthz` 启动即可响应,便于 systemd / k8s readiness。
2. **先 WgConfig 后 GatewayConfig** — wg_config 是阻塞点(NSD 不发即 fail);gateway_config 是 best-effort(超时 5s 后回退用 `server_url`)。
3. **先 ACL 后 Transport** — 初始 ACL 等待上限 2s;超时后继续启动,WSS 链路在拿到 ACL 前 default deny。

详见 → [07 · lifecycle.md](../07-nsn-node/lifecycle.md)

## 5. 监控 API 与 telemetry

11 条 HTTP 端点(全部只读、无鉴权,默认 loopback only):

| Path | 用途 |
| --- | --- |
| `GET /healthz` | 存活探针 + per-endpoint 连通性 (systemd / k8s) |
| `GET /api/status` | 全局一屏概览 |
| `GET /api/node` | 节点身份 + SystemInfo |
| `GET /api/gateways` | 每网关连接 / 字节 / 握手 |
| `GET /api/control-planes` | 每 NSD 连接状态 |
| `GET /api/tunnels` | 每网关 WG 隧道度量 |
| `GET /api/services` | 本地服务白名单(含 `enabled=false`) |
| `GET /api/acl` | ACL policy 摘要 + 最近拒绝 ring buffer (100) |
| `GET /api/nat` | NAT 表统计 |
| `GET /api/connections` | 活跃 / 总 / per-proto / per-service 连接 |
| `GET /api/metrics` | OTel + `nsn_*` 汇总指标 (Prometheus text) |

完整字段表 → [07 · monitor-api.md](../07-nsn-node/monitor-api.md)

telemetry crate (51 行 lib + 115 行 metrics):
- `init_telemetry()` 注册 OTel MeterProvider 并绑 Prometheus exporter
- `ProxyMetrics` / `TunnelMetrics` 提供原子计数器结构
- 失败时 `/api/metrics` 仍可访问,只输出手写 `nsn_*` 汇总

详见 → [07 · telemetry.md](../07-nsn-node/telemetry.md)

> 注意: 本现状下 OTel 只是注册了 pipeline,**业务 crate 几乎没接 instrument**;这是 [bugs.md OBS-001/OBS-007](./bugs.md#5-可观测性-obs--12-条) 要解决的问题。

## 6. ACL / Proxy / NAT

NSN 数据面的"三件套":

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `acl::AclEngine` | `crates/acl/` | 主体 (subject) × 资源 × 动作的策略求值 |
| `nat::ServiceRouter` | `crates/nat/router.rs` | 端口→服务查找,代理决策入口 |
| `nat::ConntrackTable` | `crates/nat/packet_nat.rs` | 反向 NAT 映射(目前**无 GC/TTL/cap**,见 [bugs FUNC-005](./bugs.md#func-005)) |
| `validator::find_violations` | `crates/nsn/validator.rs` | 把 NSD 下发的 ProxyConfig 与本地 services.toml 对账 |

ACL 评估有**两条独立链路**:WSS 入站 (`tunnel-ws`) 与本地路由 (`nat::ServiceRouter`),共享但不同步两份 `Arc<AclEngine>`,fail 语义不对称。详见 [bugs ARCH-001 / SEC-001](./bugs.md#arch-001--sec-001--acl-双-arc--语义不对称)。

详见 → [05 · proxy-acl/index.md](../05-proxy-acl/index.md)

## 7. services.toml(本地白名单)

设计约束:

1. **本地是权威** — NSN 从不让 NSD 告诉它能代理什么;NSN 先把 `ServiceReport` 上报给 NSD,NSD 再下发匹配的 proxy 规则。
2. **fail-closed** — 没有 `services.toml` 或为空 → 严格空配置 → 全部拒绝。
3. **strict 默认 true** — `--permissive` 仅作 dev / test 逃生舱。
4. **fqid 约定** — `<service_name>.<machine_id>.n.ns`;NSC 用这个 FQDN 通过本地 DNS 解析到 VIP。

`ServicesAck` 三类回应:

- `matched` — 该服务至少有一条 NSD 端 proxy 规则指向它
- `unmatched` — 已上报但 NSD 没规则(策略未绑定)
- `rejected` — NSD 端有规则指向本 NSN、但 service 名不在本地白名单(策略配置错误)

详见 → [07 · services-report.md](../07-nsn-node/services-report.md)

## 8. 多 NSD / 多 NSGW

| 维度 | NSD(控制面) | NSGW(数据面) |
| --- | --- | --- |
| 实现 | `MultiControlPlane` (`control/multi.rs:131`) | `MultiGatewayManager` (`connector/multi.rs:152`) |
| 合并语义 | wg = 并集;proxy = 并集;**acl = 交集**(已决议改并集 + 本地 ACL 保底) | 选路 = lowest_latency / round_robin / priority |
| 异常容忍 | 任一 NSD 推空 ACL → 清空全局 ACL(待修) | 异常 NSGW 标 Failed,不影响其他 |
| 健康检查 | SSE 流自然探活 | `health_interval` 字段标 `dead_code`,**未真正定时探活** |

详见 → [02 · multi-realm](../08-nsd-control/multi-realm.md) / [10 · current-state §5](../10-nsn-nsc-critique/current-state.md#5-多-nsd--多-nsgw)

## 9. 关键 mpsc 缓冲与背压

| 通道 | 容量 | 行为 |
| --- | --- | --- |
| `WsTunnel::write_tx`(出帧) | 256 | `await` 满则阻塞调用方 |
| 单 stream `data_tx`(每条 WSS 流) | 64 | `await` 满则阻塞 |
| `tunnel-wg::decrypted_tx` / `to_encrypt_tx` | 256 | 同上 |
| `connector::proxy_done_rx` | 1 | 容量 1,只传一次结束信号 |
| `MultiGatewayManager::event_tx` | 调用方设置 | `try_send` 失败**静默丢弃** |

只有 GatewayEvent 是 `try_send` 静默丢;其余路径用 `await` 反向施压上游。**目前没有任何 metric 暴露 channel 占用率**(见 [bugs OBS-004](./bugs.md#5-可观测性-obs--12-条))。

## 10. 测试矩阵

- 单元 / 集成测试 ~300 个
- Docker E2E 4 套(`tests/docker/docker-compose.*.yml`):WG / WSS / Noise / QUIC
- 测试覆盖率工具未集成 / 未在 CI 报告

## 11. 依赖清单

NSN 依赖的 12 个内部 crate:

```
nsn → state / health / monitor / validator
   ├→ common (services / system_info / state_dir)
   ├→ control (multi / sse / noise / quic / messages)
   ├→ connector (multi gateway / proxy_done)
   ├→ tunnel-wg (gotatun)
   ├→ tunnel-ws (WsFrame protocol)
   ├→ nat (ServiceRouter / ConntrackTable / packet_nat)
   ├→ netstack (smoltcp 包装)
   ├→ proxy (handle_tcp_connection — 部分被 main.rs 替代)
   ├→ acl (AclEngine + matcher)
   └→ telemetry (OTel + Prometheus exporter)
```

外部依赖关键项:`tokio` / `axum` / `figment` / `clap` / `tracing` / `gotatun` / `smoltcp` / `prometheus` / `opentelemetry` / `dashmap` / `arc-swap`。

---

更详细的功能展开请按需打开:

- [07 · nsn-binary](../07-nsn-node/nsn-binary.md) — main / CLI / 模块装配
- [07 · lifecycle](../07-nsn-node/lifecycle.md) — 启动顺序 / 配置流 / 优雅关停
- [07 · health-monitor](../07-nsn-node/health-monitor.md) — `health` / `monitor` / `validator` / `state` 职责边界
- [07 · monitor-api](../07-nsn-node/monitor-api.md) — HTTP 端点字段表
- [07 · services-report](../07-nsn-node/services-report.md) — `services.toml` → `ServiceReport` → NSD
- [07 · telemetry](../07-nsn-node/telemetry.md) — OTel + Prometheus 装配
