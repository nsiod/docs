# 控制面设计 (Design)

> 关注点：与 NSD 的契约、关键流程、合并策略与可靠性机制。
> 实现细节见 [implementation.md](./implementation.md)。

## 1. 设备身份与密钥

`crates/common/src/state.rs:71` 定义 **MachineIdentity**：

| 字段 | 类型 | 用途 |
|------|------|------|
| `signing_key` | Ed25519 `SigningKey` | 在认证阶段签名挑战 |
| `machine_key_pub` | `[u8; 32]` | Ed25519 公钥，注册时上送 |
| `peer_key_priv` | X25519 `SecretBox<[u8; 32]>` | WireGuard 私钥（仅本机持有） |
| `peer_key_pub` | `[u8; 32]` | WireGuard 公钥，注册时上送 |

身份持久化策略：

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| 文件持久化 | 默认 | `{state_dir}/machinekey.json` (0600) 存放 keypair；`{state_dir}/registrations/{realm}.json` 存放 NSD 返回的 `machine_id` / `nsd_pubkey` / `server_endpoint` / `domain_base` |
| 无状态派生 | `--auth-key` + `--machine-id` 同时设置 | `MachineState::from_credentials()` (`state.rs:215`) 用 `SHA-512(auth_key \0 machine_id)` 派生：前 32B → Ed25519 seed，后 32B → X25519 seed；每次启动重复幂等注册 |

> 一次 NSD 注册响应的 `nsd_pubkey` 会被写入 state 文件，从而第二次启动可以直接走 Noise/QUIC 握手（**当配置 `--control-mode noise|quic` 但用户未提供 `--nsd-pubkey` 时即可复用**）。

### 多 Realm

`MachineState::load_or_create_for_realm()` (`state.rs:147`) 把全局 keypair 与 **per-realm 注册状态**解耦：

```
{state_dir}/
├── machinekey.json                 ← 全局，永远不变
└── registrations/
    ├── default.json                ← Realm A 的 machine_id / NSD pubkey
    ├── tenant-acme.json            ← Realm B
    └── selfhosted-prod.json        ← Realm C
```

同一台机器可同时向云端共享 NSD（共享 realm）和企业自托管 NSD（独立 realm）注册，**只需一份密钥但保留独立的 `machine_id`**。

## 2. 认证流程

### 2.1 三种认证路径总览

| 路径 | 触发条件 | 关键端点 | 凭证形态 |
|------|----------|----------|----------|
| **首次：authkey** | `MachineState::is_registered() == false` 且 `auth_key` 已配置 | `POST /api/v1/machine/register` 携带 `auth_key` | 一次性预共享密钥 |
| **首次：device-flow** | 未注册、未提供 `auth_key`、`NsdInfo.auth_methods` 包含 `DeviceFlow` | `POST /device/code` → 轮询 `POST /device/token` → 用 Bearer 调 `POST /machine/register` | OAuth2 Bearer access_token |
| **每次启动：signature** | 已注册（含每次重连） | `POST /api/v1/machine/auth` | Ed25519 签名 `"{machine_id}:{unix_secs}"` 换 JWT |

### 2.2 register / authenticate 详细消息

`POST /api/v1/machine/register` 请求体（`auth.rs:28`）：

```jsonc
{
  "auth_key": "ak_...",                 // optional：device-flow 模式置 null，改走 Authorization: Bearer
  "machine_id": "ab3xk9mnpq",           // optional：客户端预指定时服务端必须采纳并幂等更新
  "machine_key_pub": "<32B hex>",        // Ed25519 公钥
  "peer_key_pub":    "<32B hex>",        // X25519 (WireGuard) 公钥
  "hostname":  "site-a-node",
  "os":        "linux",
  "version":   "0.x.x",
  "system_info": { /* SystemInfo */ }    // optional
}
```

响应（`auth.rs:100`）：

```jsonc
{
  "machine_id":          "ab3xk9mnpq",
  "server_peer_key_pub": "<32B hex>",   // NSD 自身的 X25519 公钥（用于 Noise/QUIC）
  "server_endpoint":     "10.0.0.1:51820",
  "domain_base":         "ab3xk9mnpq.m.ns.io"  // optional
}
```

`POST /api/v1/machine/auth` 请求体（`auth.rs:110`）：

```jsonc
{
  "machine_id":      "ab3xk9mnpq",
  "machine_key_pub": "<32B hex>",
  "timestamp":       1713234567,
  "signature":       "<Ed25519(\"ab3xk9mnpq:1713234567\") hex>"
}
```

响应：`{ "token": "<JWT>" }`，token 形如 `header.payload.signature`（`messages.rs:614` 测试约束）。

### 2.3 OAuth2 Device Authorization Grant

`device_flow.rs` 严格遵循 RFC 8628：

1. `POST /api/v1/device/code` body `{ "client_id": "nsio-connector" }`，返回 `device_code` / `user_code` / `verification_uri[_complete]` / `expires_in` / `interval`。
2. CLI 在 stdout 打印用户可视提示（含 URL 与 user_code）。
3. 按 `interval` 秒（默认 5 秒，最小 1 秒）轮询 `POST /api/v1/device/token`，body 内 `grant_type = "urn:ietf:params:oauth:grant-type:device_code"`。
4. 错误处理：
   * `authorization_pending` / `slow_down` / 无 `error` → 继续轮询；
   * `expired_token` → `Error::Auth("device code expired")`；
   * `access_denied` → `Error::Auth("device authorization denied by user")`；
   * 其它 → 透传错误码。
5. 整体 deadline 为 `expires_in + 5s`，超出立刻返回错误（`device_flow.rs:90`）。

> 详见 [diagrams/auth-sequence.d2](./diagrams/auth-sequence.d2)。

## 3. SSE 事件表

`ControlMessage` 枚举使用 `#[serde(tag = "type", rename_all = "snake_case")]`（`messages.rs:208`），所有事件统一形如 `data: {"type":"<name>", ...}\n\n`。

| `type` 值 | 方向 | 触发时机 | 字段 | 下游消费者 |
|-----------|------|----------|------|------------|
| `wg_config` | NSD→NSN | NSN 注册后立即推送，对端列表变更后推送 | `ip_address: Ipv4Addr`、`listen_port: u16`、`peers: [{public_key:[u8;32], endpoint:SocketAddr, allowed_ips:[IpNet], persistent_keepalive:u16, machine_id:Option<String>}]` | `tunnel-wg`（设备配置 + `PeerIdentityMap` 更新，见 [../03-data-plane/tunnel-wg.md §2.4](../03-data-plane/tunnel-wg.md#24-直连路径的-peer-identity-映射)） |
| `proxy_config` | NSD→NSN | 服务/规则变更 | `chain_id: String`、`rules: [{resource_id, source_prefix:IpNet, dest_prefix:IpNet, rewrite_to:RewriteTarget, port_range:Option<(u16,u16)>, protocol:Protocol}]` | `nat`（DNAT/SNAT） |
| `acl_config` | NSD→NSN | ACL 策略变更 | `chain_id: String`、`policy: acl::AclPolicy`（subjects/hosts/acls/tests/groups） | `acl`（终决） |
| `acl_projection` | NSD→NSGW | 同 `acl_config` 事务内 push | `chain_id: String`、`groups: HashMap<String,[Subject]>`、`acls: [AclRule]`（仅 User/Group/Nsgw 维度） | NSGW（`/client` ingress 预过滤，见 [../05-proxy-acl/acl.md §4.6](../05-proxy-acl/acl.md#46-两级信任nsgw-预拒--nsn-终决)） |
| `gateway_config` | NSD→NSN | NSGW 列表变更 | `gateways: [{id, wg_endpoint:String, wss_endpoint:String}]` | `connector` |
| `routing_config` | NSD→NSN | NSGW 反代路由表变更 | `routes: [{domain, site, service, port}]` | `nsgw`/`nsc` |
| `dns_config` | NSD→NSN | 全局 DNS 变更 | `records: [{domain, site, service, port}]` | `nsc`（本地 DNS） |
| `services_ack` | NSD→NSN | NSN 上送 `services_report` 后回执 | `matched: [name]`、`unmatched: [name]`、`rejected: [resource_id]` | 仅日志（信息提示，便于运维发现 services.toml ↔ 规则不一致） |
| `token_refresh` | NSD→NSN | NSD 主动滚动 JWT | `token: String` | 控制面更新自身 token + 推送到 `token_refresh_tx` |
| `ping` | NSD→NSN | 服务端 keep-alive 注入 | 无字段 | 忽略（SSE 单向，无需 pong） |
| `pong` | — | 不应在该流上出现 | 无 | 收到则忽略并打 warn |
| `services_report` | NSN→NSD（HTTP POST） | 每次 SSE 连接前 | `services: HashMap<name, ServiceInfo>`、`strict_mode: bool`、`system_info?: SystemInfo` | 上行 |

> SSE 事件分发由 `ControlPlane::dispatch_message()` (`lib.rs:345`) 实现；任一下游 `mpsc::Sender` 收到 `SendError`（即下游 `Receiver` 已 drop）会让方法返回 `Ok(true)` 触发优雅停机。

### 3.1 services_report ↔ services_ack 反馈环

`ServiceReport`（`messages.rs:88`）由 `ServicesConfig`（`crates/common/src/services.rs:210`）派生而来，每次 SSE 连接（含重连）都会重新 POST：

```jsonc
POST /api/v1/services/report
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "services": {
    "web": {"protocol":"tcp","host":"192.168.1.10","port":80,"enabled":true,
            "tunnel":"auto","gateway":"auto"},
    "db":  {"protocol":"tcp","host":"10.0.0.5",   "port":5432,"enabled":true,
            "tunnel":"wg",  "gateway":"gw-eu-west"}
  },
  "strict_mode": true,
  "system_info": { /* optional */ }
}
```

服务端随后通过 SSE 回 `services_ack`，告诉客户端：

| 字段 | 含义 | 处置 |
|------|------|------|
| `matched`   | 至少有一条 proxy 规则命中的服务名 | INFO 日志 |
| `unmatched` | 客户端声明了但**没有任何 proxy 规则**指向的服务名 | WARN：可能配置遗漏 |
| `rejected`  | proxy 规则指向了客户端**未声明**的服务（resource_id） | WARN：服务端规则陈旧或 services.toml 缺项 |

### 3.2 SSE 帧解析与限流

* 帧格式：标准 SSE，`data: <json>\n` 多行后以空行 `\n\n` 终止（`sse.rs:160`）。每个事件块只取**第一条** `data:` 行。
* 分块读取：`reqwest::Response::chunk()` 增量喂入 `String` 缓冲区，按 `\n\n` 切分（`sse.rs:174`）。
* **限流**：`TokenBucket`（`sse.rs:14`）容量 = 每秒上限 = `ConnectorConfig.ws_max_messages_per_sec`（默认 100），超额事件丢弃并 WARN，不断流。
* **大小限制**：单条 `data:` 超过 `ws_max_message_size`（默认 1 MiB）丢弃并 WARN。
* `Ping` 事件命中限流被丢弃也无影响——**SSE 是单向的，没有 pong 协议**。

## 4. 多 NSD 配置合并

### 4.1 整体结构

`MultiControlPlane::run()` (`multi.rs:131`) 流程：

1. 对每条 `ControlCenterConfig` 实例化一个 `ControlPlane`（`base_config.server_url` 被覆盖为该 NSD 的 url）。
2. 为每个 NSD 派生 7 个 `tokio::spawn` 任务，把 wg/proxy/acl/gateway/routing/dns/token-refresh 的 `mpsc::Receiver` 桥接为带 `nsd_id` 标签的 `NsdUpdate` 投到统一通道。
3. 主合并循环维护 `NsdConfigStore`（`merge.rs:149`，三张 `HashMap<nsd_id, Config>`），**每收到一条更新就重算合并结果并下推**到下游通道（`multi.rs:295`）。
4. 任意上行任务因 NSD 永久下线而退出时，merge 循环还会继续，使用其它 NSD 仍在线的最新配置。

> 注意：`gateway_config`、`routing_config`、`dns_config` 当前**直接透传第一个收到的版本**，不做合并（`multi.rs:327` 起），因为它们带 NSD 全局视角，已由 NSD 侧计算好。

### 4.2 合并规则

| 配置 | 策略 | 实现 | 设计意图 |
|------|------|------|----------|
| `WgConfig` | 多源 peers **并集**，按 `public_key` 去重；保留首条配置的 `ip_address` / `listen_port` | `merge.rs:27` `merge_wg_configs` | 站点能同时与所有 NSD 给出的所有对端通信；同 key 不同 endpoint 时**先到先得** |
| `ProxyConfig` | rules **并集**，按 `resource_id` 去重；保留首条配置的 `chain_id` | `merge.rs:56` `merge_proxy_configs` | 任何 NSD 提到的资源都可以被代理 |
| `AclConfig` | hosts / groups / acls / tests **并集**，按等价键去重；每条保留带来源 NSD 标注 | `merge.rs:85` `merge_acl_configs` | **与 wg/proxy 同向**：接入 NSD 只扩不删规则；安全由本地 `services.toml` ACL 作为最终保底裁决（见 [multi-realm.md §4.5](../08-nsd-control/multi-realm.md#45-本地-acl-作为保底)） |

`AclRule` 的等价键：`"accept\0{subject 排序}\0{dst 排序}\0{proto or *}"`（`merge.rs:128`），这样 `subject`/`dst` 列表顺序不影响等价判定。`groups` 按组名 merge：同名组的成员列表取并集（两个 NSD 都维护 `group:eng` 时成员相加、去重）。

> 示例：NSD-A 独有 `accept user:ab3xk9mnpq → db:5432`、NSD-B 独有 `accept group:eng → db:5432` → 合并后两条规则**全部保留**，分别标记来源 NSD-A / NSD-B。Group `eng` 如果两边都定义，成员取并集。
> **运行时放行**还要通过本地 `services.toml` ACL 再校验一次，站点主人对最终边界保留否决权。

### 4.3 示例

输入（两个 NSD）：

```text
NSD-1 wg:    peers = [P1, P2]
NSD-2 wg:    peers = [P2, P3]
NSD-1 proxy: chain_id = "c1", rules = [r1, r2]
NSD-2 proxy: chain_id = "c2", rules = [r2', r3]   // r2' 与 r2 同 resource_id
NSD-1 acl:   groups={eng:[u1,u2]}  rules={ accept group:eng→B, accept user:u3→D }
NSD-2 acl:   groups={eng:[u2,u4]}  rules={ accept group:eng→B, accept user:u5→F }
```

合并结果：

```text
wg:    peers = [P1, P2, P3]                                    // 并集去重
proxy: chain_id = "c1", rules = [r1, r2, r3]                   // r2 来自 NSD-1（先到）
acl:   groups = { eng: [u1, u2, u4] }                          // 同名组成员并集
       rules  = { accept group:eng→B [sources=NSD-1,NSD-2],    // 等价键相同 → 合并 sources
                  accept user:u3→D    [sources=NSD-1],
                  accept user:u5→F    [sources=NSD-2] }         // 并集，每条带 sources
// 最终放行 = merged_acl ∩ services.toml 本地 ACL
```

> 全套数据流见 [diagrams/multi-nsd-merge.d2](./diagrams/multi-nsd-merge.d2)。

### 4.4 事件状态频道

`MultiControlPlane` 多输出一个 `mpsc::Receiver<String>` (`multi.rs:97`)，每当某 NSD **首次或再次**投递任意配置时，它的 `id` 就会 push 到该通道，供监控 / `/api/status` 显示「这条 NSD 当前在线且有数据」。

## 5. Keep-alive、重连与 backoff

| 维度 | 行为 | 源码 |
|------|------|------|
| TCP/TLS 连接 | `reqwest::Client` 默认连接复用 + HTTP/2 | `auth.rs:67`, `sse.rs:83` |
| SSE 心跳 | 完全依赖服务端注入 `: comment` 行或 `data:{"type":"ping"}` 维持流；客户端不主动写 | `sse.rs:374` |
| 流断开判定 | `response.chunk()` 返回 `Ok(None)` ⇒ "stream ended"；`Err` ⇒ 同上 | `sse.rs:186` |
| 退避 | 1 → 2 → 4 → 8 … → **60s 上限**；任意成功事件后重置为 1s | `lib.rs:198` / `:206` / `:219` |
| 重连前重新认证 | 是。每次外层 loop 顶部重新 `authenticate()` 拿新 token | `lib.rs:241` |
| 优雅停机 | 任一下游 `mpsc::Sender::send` 收到 `SendError` ⇒ `dispatch_message` 返回 `Ok(true)` ⇒ `run()` 返回 | `lib.rs:354`+ |
| 心跳上报 | `HeartbeatClient::heartbeat()` `POST /api/v1/machine/heartbeat`（5s 连接 / 10s 整体超时），周期由调用方控制 | `auth.rs:83` |

## 6. 可插拔传输

`crates/control/src/transport/` 实现一个 trait：

```rust
pub trait ControlTransport: Send + Sync {
    fn connect<'a>(&'a self, endpoint: &'a str)
        -> BoxFuture<'a, Result<BoxStream, crate::Error>>;
    fn name(&self) -> &str;
}
```

| 模式 | `connect()` 行为 | 客户端验证服务端身份的方式 | DPI 可见特征 |
|------|------------------|---------------------------|--------------|
| `sse` (默认) | 标准 TLS over TCP | `webpki-roots` 公共 CA | TCP + SNI + TLS 握手指纹 |
| `noise` | TCP → Noise_IK_25519_ChaChaPoly_BLAKE2s 握手 | 预共享 NSD `peer_key_pub`（32B X25519），客户端用 `peer_key_priv` 应答 | 一次 TCP，随后随机字节流 |
| `quic` | QUIC over UDP，自定义 `ServerCertVerifier` | NSD 自签证书的 SHA-256 DER 指纹（32B），等同 `nsd_pubkey` | UDP 包，无 SNI/CA |

公共特性：

* **inner-SSE 不变**：Noise / QUIC 模式由 `NoiseControl`（`sse.rs:245`）手动构造 HTTP/1.1 请求行 + `Host`/`Authorization`/`Connection: keep-alive`，复用同一份 SSE 解析逻辑。
* **共享身份**：`NoiseTransport::new(local_priv, remote_pub)` 直接复用 `MachineState.peer_key_priv`（`lib.rs:456`），不引入额外密钥。
* **回退**：`ConnectorConfig.control_mode = "noise"|"quic"` 但 `nsd_pubkey` 未配置或不合法时，`build_noise_transport` / `build_quic_transport` 失败 → WARN 后回退默认 SSE（`lib.rs:107`+）。
* **URL 重写**：`auth.rs:15` `to_http_base()` 把 `noise://host:port` / `quic://host:port` 重写为 `http://host:port` 给 HTTP API 使用（注册 / 心跳 / discovery 仍走普通 HTTP，仅长连接走 Noise/QUIC）。
* **HTTP 头解析硬上限**：手卷 HTTP 时 `read_http_status()` 限制头部 ≤ 16 KiB（`sse.rs:452`），防止恶意巨型响应耗尽内存。

## 7. 安全要点速查

| 主题 | 处理 |
|------|------|
| 私钥外泄 | 私钥（Ed25519 + X25519）从不进入 `WgConfig` 序列化（`messages.rs:262` 测试约束） |
| Replay 防护 | `authenticate()` 签名包含当前 unix 秒时间戳，服务端按时钟 skew 校验 |
| Authkey 泄漏 | authkey 只用于注册一次；服务端写完 `machine_id` 后客户端不再保存 authkey 文本 |
| Realm 名注入 | `validate_realm_name()` 限制为 `[A-Za-z0-9._-]+`（`state.rs:334`），防止路径穿越 |
| 大消息攻击 | SSE `max_message_size`（默认 1 MiB）+ HTTP header 16 KiB 上限 |
| 流量轰炸 | TokenBucket 每秒上限 100 事件（默认） |
| MITM | TLS（`sse`）/ Noise IK 静态密钥 / QUIC SHA-256 cert pin 三选一 |
| ACL 一致性 | 多 NSD 模式下 ACL 取并集并标注来源；**最终放行由本地 `services.toml` ACL 兜底** —— 单点 NSD 即使下发 `allow all` 也无法越过本地未列出的端口 |
| 配置推送完整性 | `gateway_config` / `routing_config` / `acl_config` / `wg_config` 等 SSE 事件每条带 NSD 签名（见 §7.1），NSN/NSC 本地用注册响应中的 `server_peer_key_pub` 验签，拒绝未签名或验签失败的事件 |

### 7.1 配置事件签名（防中间人篡改）

控制面所有长连接（`sse` / `noise` / `quic`）都可能落在**不可信的传输层**上：

- `sse` 模式走标准 TLS，但 TLS 只保护 *点到点*；一旦运营者在公司出口放了 TLS 反代（SSL 卸载盒子 / 企业 CA 下发到员工机器），反代节点就具备**在线改写 SSE 事件**的能力，而客户端对此不可见。
- `noise` / `quic` 模式自己承担加密与对端鉴权，但在"pinning 未配置"或"NSD 部署方把原始证书/静态密钥外包给 CDN"等降级场景下同样可被中间人替换事件。

为此每条 NSD → NSN / NSC / NSGW 的配置事件（`wg_config` / `proxy_config` / `acl_config` / `acl_projection` / `gateway_config` / `routing_config` / `dns_config` / `gateway_http_config` / `gateway_l4_map` / `token_refresh`）都带**独立签名**，与传输层加密解耦：

```jsonc
{
  "event": "acl_config",
  "chain_id": "acl-2026-04-17-001",
  "payload": { /* AclConfig 原内容 */ },
  "sig": {
    "alg": "ed25519",
    "kid": "nsd-primary-2026q2",         // NSD 签名密钥指纹，便于轮换
    "ts":  1713340800,                    // 签发 unix 秒（防回放）
    "nonce": "base64(16B)",               // 单次事件不重复
    "value": "base64(64B Ed25519 sig)"
  }
}
```

**签名对象**：`SHA-512(event || "\0" || chain_id || "\0" || canonical_json(payload) || "\0" || ts || "\0" || nonce || "\0" || realm || "\0" || machine_id)` —— 绑定事件类型、chain_id、canonical 序列化的 payload、时间、nonce、realm 与目标 `machine_id`，确保：

1. **payload 不能被改写**：篡改任何字段都会破坏 SHA-512。
2. **不能跨 realm 重放**：`realm` 入 digest，不同 realm 的签名互不通用。
3. **不能跨 machine 重放**：`machine_id` 入 digest，A 机器的事件不能塞给 B。
4. **不能时间回放**：`ts` 允许时钟偏差 ±5min；`nonce` 在同一 chain_id 内必须唯一；`chain_id` 在同一目标上单调递增（旧版本 chain_id 拒绝）。
5. **不能裁切**：`canonical_json(payload)` 按 [RFC 8785 JCS](https://datatracker.ietf.org/doc/html/rfc8785) 规范化后再哈希，避免 key 顺序 / 空白 / 数字表示差异导致的签名歧义。

**密钥体系**：采用**两级签名链**（root + signing cert）—— NSN/NSC 在注册时 *pin 一次 root 公钥*，之后所有运行态密钥都由 root 签发的证书携带，**签名密钥泄漏只需轮换证书，不需要重新 pin root**。参见 §7.2。

**与 transport 的关系**：

| 层 | 保证 | 失效时的影响 |
|-----|------|--------------|
| TLS / Noise / QUIC（transport）| 对端鉴权 + 抗被动嗅探 | 被反代 / 降级 → 需要签名层兜底 |
| 配置事件签名（应用层）| 事件完整性 + 来源 + 抗重放 + 抗跨 realm / 跨 machine | 签名密钥泄漏 → root 吊销旧证书 + 签发新证书，旧签名全部作废 |

这解决了 transport 被中间人降级、或 SSE 走普通 TLS 经企业反代时事件被改写的问题——两层都被攻破才能影响配置，而不是单层被攻破就放行篡改。

### 7.2 两级签名链：Root + Signing Cert

**动机**：若只有一把 `server_signing_key_pub` 在线持有，一旦它泄露，所有已注册的 NSN / NSC 都必须重新走注册流程才能 pin 到新密钥。在有成千上万个节点 + 多 realm 的场景下，这等于"一次小事故 = 全网手动运维一次"。

把密钥拆成两层，借鉴 [DNSSEC KSK/ZSK](https://datatracker.ietf.org/doc/html/rfc6781#section-3.1)、[TUF 根/目标密钥](https://theupdateframework.io/specification/latest/#threat-model)、[X.509 CA/中间证书](https://datatracker.ietf.org/doc/html/rfc5280)的做法：

| 层 | 密钥 | 生命周期 | 存储位置 | 职责 |
|----|------|----------|---------|------|
| **Root** | `realm_root_key`（Ed25519） | 多年（3–5 年）| **离线** HSM / YubiKey / 气隙机 | 只做一件事：签发 signing cert。绝不参与在线流量，绝不加载进 NSD 进程内存 |
| **Signing** | `realm_signing_key_{n}`（Ed25519） | 短期（30–90 天，可配）| NSD 在线热路径（内存 / KMS） | 对每条配置事件签名 |

**Root 签发的签名证书 (`SigningCert`)**：

```jsonc
{
  "kid":        "sign-2026q2-01",          // 本证书的指纹
  "realm":      "company.internal",         // 绑定 realm，不可跨用
  "pub":        "<32B hex Ed25519 pub>",    // 本证书授权的在线签名公钥
  "not_before": 1713340800,                 // 生效时间
  "not_after":  1721203200,                 // 过期时间（短）
  "root_kid":   "root-2026-v1",             // 指向哪个 root 签发（允许 root 自身未来滚动）
  "root_sig":   "base64(64B Ed25519)"        // root_signing_key 对以上字段（canonical JSON）的签名
}
```

NSN / NSC 本地只需要长期保管 **root 公钥** `realm_root_key_pub`。每次收到事件，按下面流程校验：

[SigningCert 两步验签流程](./diagrams/signing-cert-verify.d2)

两步验签缓存友好：`SigningCert` 的 `root_sig` 只在**第一次见到这张 cert** 时验证一次，后续同 `kid` 的事件只走 cert.pub 的签名校验；cert 过期或被吊销时从缓存中清除。

**配置事件签名信封**扩展为携带 kid 指向 cert，而不是直接公钥：

```jsonc
{
  "event":    "acl_config",
  "chain_id": "acl-2026-04-17-001",
  "payload":  { /* AclConfig */ },
  "sig": {
    "alg":   "ed25519",
    "kid":   "sign-2026q2-01",              // 指向 SigningCert
    "ts":    1713340800,
    "nonce": "base64(16B)",
    "value": "base64(64B)"                   // cert.pub 对 digest 的签名
  }
}
```

**分发 SigningCert**：NSD 通过一条新的 SSE 事件 `signing_certs` 主动推送当前有效的 cert 列表，这条事件**自身也用 root 签名**（因为它必须被 pin 在 root 之下）：

```jsonc
{
  "event": "signing_certs",
  "certs": [ /* SigningCert[] */ ],
  "revoked_kids": ["sign-2025q4-03"],
  "issued_at": 1713340800,
  "sig": {
    "alg":   "ed25519",
    "kid":   "root-2026-v1",                 // 指向 root 自身
    "value": "base64(64B root sig)"
  }
}
```

- NSN / NSC 订阅上第一件事：接收 `signing_certs`，验 root 签名后把证书加载进本地 cert store；
- 同一 realm 同一时刻可以有**多张有效 cert**（便于无缝滚动），每张各带 `not_before` / `not_after`；
- NSD 每 N 分钟重发一次 `signing_certs` 作为 liveness 心跳。

**注册响应**因此只下发 root 公钥 + 初始 cert 列表：

```jsonc
// POST /api/v1/machine/register 响应扩展
{
  "machine_id":            "ab3xk9mnpq",
  "server_peer_key_pub":   "<32B hex>",      // X25519 —— Noise/QUIC 传输层（不变）
  "realm_root_key_pub":    "<32B hex>",      // Ed25519 —— root 签名公钥（长期 pin）
  "root_kid":              "root-2026-v1",
  "initial_signing_certs": [ /* SigningCert[] */ ]  // 首批有效签名证书
}
```

NSN 把 `realm_root_key_pub` + `root_kid` 永久写入 `{state_dir}/registrations/{realm}.json`（权限 0600）。后续所有配置事件、`signing_certs` 更新，都靠这把 root 公钥递归可信。

### 7.3 密钥轮换与吊销

| 场景 | 处置 | NSN / NSC 端工作量 |
|------|------|---------------------|
| **Signing key 按期滚动**（每 30–90 天） | NSD 提前生成新 kid 的 `SigningCert`，root 离线签发后推入线上。通过 `signing_certs` 事件广播；新旧 cert 在 grace window 内**同时有效** | 零。事件驱动，自动缓存新 cert |
| **Signing key 泄漏** | Root 立即发出带 `revoked_kids: ["<kid>"]` 的 `signing_certs` 事件；新 cert 同步推送；持久化吊销列表 | 零。从收到 revoked 广播起，带该 kid 的所有事件一律拒绝；已应用的历史配置**不会被回溯撤销**（因为它们已经落盘生效；若要失效需要 NSD 推新版覆盖） |
| **Root key 轮换**（计划内，多年一次） | 离线仪式：生成 `realm_root_key_v2`，用**旧 root 签**一张带过渡标志的 `root_transition` 证书 `{old_kid, new_pub, new_kid, not_after}` | 少。事件携带 `root_transition`，NSN 验旧 root 签名后把新 root 公钥追加到本地信任集；等所有 SigningCert 都迁到新 root 后，旧 root 可以从本地清除 |
| **Root key 丢失 / 泄漏**（灾难） | 无法用旧 root 自证继任者 → 必须**所有 NSN / NSC 人工重 pin** | 手动：通过带外渠道（邮件 / 员工门户 / MDM）分发新 root 公钥，管理员通过 `nsn register --force-root-pin=<hex>` 覆盖本地 registration 文件 |

- **好处**：99.9% 的密钥问题（"签名密钥怀疑泄漏"）都是 *签名密钥* 级别——用两级链把这类事件从"全网重 pin"降为"root 离线签个新证书、推送一条广播事件"。
- **代价**：
  1. 注册响应多几百字节（一批初始 cert + root 公钥）。
  2. NSD 多维护一条 `signing_certs` SSE 通道（周期 ~分钟级）。
  3. 每个事件验签从一次 Ed25519 校验变成一次（cert store hit 时）或两次（首次见 cert）——绝对值仍是 ~30µs / 次，在 SSE ≤100 eps 的上限下微不足道。
- **Root 管理实操**：
  - 气隙签发：root 私钥永远不进 NSD 主机；签发操作由 ops 人员在专用离线机上执行，产物是一张 `SigningCert` JSON，通过只读介质拷到 NSD。
  - 双人制：root 签发流程要求双人授权（`m-of-n` HSM 门限或 YubiKey 物理同意）。
  - 应急储备：每个 realm 至少 2 把 root 公钥（主 + 备），注册响应里一并下发；主 root 丢失时可立即用备 root 推 `root_transition`，避免走"全网人工重 pin"灾难路径。

## 8. 配置入口（ConnectorConfig）

下列字段直接影响控制面行为（`crates/common/src/lib.rs:71`）：

| 字段 | 默认 | 作用 |
|------|------|------|
| `server_url` | "" | 兼容单 NSD 模式；`control_centers` 为空时使用 |
| `control_centers: Vec<ControlCenterConfig>` | [] | 多 NSD 列表；`{id, url, priority}`，按 priority 升序 |
| `state_dir` | `/var/lib/nsio` | machinekey + 注册状态目录 |
| `auth_key` | None | 一次性注册密钥 |
| `machine_id` | None | 与 `auth_key` 同时设置时进入无状态派生模式 |
| `ws_max_messages_per_sec` | 100 | SSE 入站事件 token bucket 容量 |
| `ws_max_message_size` | 1 MiB | SSE 单事件 payload 上限 |
| `control_mode` | `"sse"` | `sse`/`noise`/`quic` 之一 |
| `nsd_pubkey` | None | Noise/QUIC 模式必填，hex 32B |
