# 控制面模块 (Control Plane)

> 模块根目录：`crates/control/` + `crates/common/`
> 兄弟模块：[../01-overview/README.md](../01-overview/README.md) · [../03-data-plane/README.md](../03-data-plane/README.md)

## 1. 模块职责

控制面是 NSN 与 NSD（Network Site Daemon，控制中心）之间的全部交互层。它负责：

| 职责 | 实现位置 | 说明 |
|------|----------|------|
| 设备身份与密钥管理 | `crates/common/src/state.rs` | Ed25519 (machinekey) + X25519 (peerkey)，私钥永不出本机 |
| 设备注册 | `crates/control/src/auth.rs:177` `register()` / `register_with_token()` | authkey 预共享密钥 / OAuth2 device-flow Bearer token |
| 会话认证 | `crates/control/src/auth.rs:238` `authenticate()` | Ed25519 签名 `"{machine_id}:{timestamp}"` 换取 JWT |
| OAuth2 Device Flow | `crates/control/src/device_flow.rs` | RFC 8628，交互式浏览器授权 |
| SSE 配置分发 | `crates/control/src/sse.rs` (`SseControl` / `NoiseControl`) | `GET /api/v1/config/stream` 长连接，单向推送 |
| 服务清单上报 | `crates/control/src/sse.rs:104` `post_services_report()` | 连接前 POST 本地 `services.toml` 摘要 |
| 多 NSD 并发管理 | `crates/control/src/multi.rs` | 同时连接多个控制中心，分别认证、合并配置 |
| 配置合并 | `crates/control/src/merge.rs` | peers 并集 / proxy_rules 并集 / ACL 交集 |
| 心跳上报 | `crates/control/src/auth.rs:58` `HeartbeatClient` | `POST /api/v1/machine/heartbeat` 周期上报 uptime / 本机 IP |
| 可插拔传输 | `crates/control/src/transport/` (`sse` / `noise` / `quic`) | 内层 SSE 协议恒定，外层加密通道可换 |
| 共享应用状态 | `crates/common/src/lib.rs`（`ConnectorConfig` 等）| 所有 crate 共用的配置 / 类型 |

下游依赖（接收控制面投递的配置 mpsc Receiver）：

| 配置 | 接收者 | 用途 |
|------|--------|------|
| `WgConfig` | `tunnel-wg` | 配置 WireGuard 设备、对端、AllowedIPs |
| `ProxyConfig` | `nat` / `proxy` | 子网级 DNAT / 端口重写 |
| `AclConfig` | `acl` | 5 元组接受策略 |
| `GatewayConfig` | `connector` | 多 NSGW 列表（WG + WSS endpoint） |
| `RoutingConfig` | `nsgw` / `nsc` | 域名 → 服务的 HTTP 路由 / DNS |
| `DnsConfig` | `nsc` | 全局 `*.n.ns` DNS 记录 |
| token 刷新 | 心跳/监控 | NSD 主动滚动 JWT |

## 2. 与 NSD 的契约（API 概览）

### HTTP 请求型端点（NSN → NSD）

| Method | 路径 | 用途 | 主要消费者 |
|--------|------|------|------------|
| `GET`  | `/api/v1/info`                | NSD 类型/Realm/支持的认证方法 发现 | `discover_nsd_info()` (`auth.rs:281`) |
| `POST` | `/api/v1/device/code`         | OAuth2 device flow：申请 user_code | `device_flow.rs:56` |
| `POST` | `/api/v1/device/token`        | OAuth2 device flow：轮询换 access_token | `device_flow.rs:101` |
| `POST` | `/api/v1/machine/register`    | 提交 (machine_key_pub, peer_key_pub, authkey/Bearer)，得到 machine_id + nsd_pubkey | `auth.rs:177` / `:194` |
| `POST` | `/api/v1/machine/auth`        | 提交 Ed25519 签名换 session JWT | `auth.rs:238` |
| `POST` | `/api/v1/machine/heartbeat`   | uptime + local_ips 周期上报 | `auth.rs:83` |
| `POST` | `/api/v1/services/report`     | 本地 services 白名单 + strict_mode | `sse.rs:104` |

### 长连接（NSD → NSN）

| Method | 路径 | 用途 |
|--------|------|------|
| `GET`  | `/api/v1/config/stream` | SSE 单向推送：`wg_config` / `proxy_config` / `acl_config` / `gateway_config` / `routing_config` / `dns_config` / `token_refresh` / `services_ack` / `ping` |

> 详细字段表见 [design.md §3](./design.md#3-sse-事件表)。

## 3. 控制面状态机

`ControlPlane::run()` (`lib.rs:159`) 在每个 NSD 连接上维护一个独立的状态机；多 NSD 由 `MultiControlPlane::run()` (`multi.rs:131`) 派生 N 个并发 task，每个内部循环结构相同：

```mermaid
stateDiagram-v2
    [*] --> Discovering : ControlPlane::run()
    Discovering --> Registering : MachineState 未注册
    Discovering --> Authenticating : 已注册 / 复用现有 state
    Registering --> Authenticating : POST /machine/register 成功
    Registering --> Backoff : 注册失败 / authkey 无效

    Authenticating --> ReportingServices : POST /machine/auth 返回 JWT
    Authenticating --> Backoff : 401/网络错误

    ReportingServices --> StreamingConfig : POST /services/report 成功
    ReportingServices --> Backoff : 失败

    StreamingConfig --> StreamingConfig : 收到 wg/proxy/acl/... 事件\n并 dispatch_message()
    StreamingConfig --> RefreshingToken : 收到 token_refresh
    RefreshingToken --> StreamingConfig : 更新 token，继续读流

    StreamingConfig --> Backoff : SSE 错误 / 流关闭
    Backoff --> Authenticating : sleep(1..60s, 指数退避)\n 再次 authenticate()

    StreamingConfig --> [*] : 下游 receiver drop\n（dispatch 返回 true）
```

要点：

1. **Authenticating** 失败时先做 backoff，再尝试重新 `authenticate()`；密钥不变所以无需重新注册（`lib.rs:241`）。
2. **Backoff** 采用 `1 → 2 → 4 → … → 60s` 指数退避并在每次成功收到事件后**重置回 1 秒**（`lib.rs:206` / `:219`）。
3. **shutdown** 仅由下游 `mpsc::Receiver` 全部 drop 触发（`dispatch_message` 返回 `Ok(true)`）。它是优雅关闭，不会 panic。
4. **token_refresh** 不会断流——直接覆盖 `SseControl::token` 并通过 `token_refresh_tx` 通知监控/心跳任务（`lib.rs:366`）。

## 4. 顶层结构

```
control/
├── lib.rs            (545)  ControlPlane / dispatch_message / 传输选择
├── auth.rs           (374)  AuthClient / HeartbeatClient / discover_nsd_info
├── device_flow.rs    (137)  OAuth2 Device Authorization Grant 客户端
├── sse.rs            (566)  SseControl + NoiseControl + TokenBucket 限流
├── merge.rs          (398)  merge_wg_configs / merge_proxy_configs / merge_acl_configs
├── multi.rs          (397)  MultiControlPlane 并发管理 + 合并主循环
├── messages.rs       (624)  ControlMessage 等所有线协议类型
└── transport/
    ├── mod.rs   (93)   ControlTransport trait + BoxStream
    ├── sse.rs   (73)   tokio-rustls TLS（默认）
    ├── noise.rs (367)  Noise_IK_25519_ChaChaPoly_BLAKE2s over TCP
    └── quic.rs  (307)  Pubkey-pinned QUIC over UDP

common/
├── lib.rs       (575)  ConnectorConfig / ControlCenterConfig / GatewayConfig
├── state.rs     (580)  MachineIdentity / MachineState / RealmRegistration / NsdInfo
├── services.rs (1011)  ServicesConfig / ServiceDef / TunnelPreference / GatewayPreference
└── tunnel.rs     (17)  Tunnel trait + TransportType
```

## 5. 文档导航

| 文件 | 内容 |
|------|------|
| [design.md](./design.md) | 认证流程、SSE 事件契约、多 NSD 合并策略、keep-alive / 重连、限流、可插拔传输 |
| [implementation.md](./implementation.md) | 逐文件职责说明、关键类型签名、消息分派表、跨 crate 协作 |
| [diagrams/auth-sequence.mmd](./diagrams/auth-sequence.mmd) | 三种认证路径的时序图 |
| [diagrams/sse-config.mmd](./diagrams/sse-config.mmd) | SSE 事件流时序 |
| [diagrams/multi-nsd-merge.mmd](./diagrams/multi-nsd-merge.mmd) | 多 NSD 配置合并数据流 |
| [diagrams/common-state.mmd](./diagrams/common-state.mmd) | `common` 共享状态与服务注册关系图 |
