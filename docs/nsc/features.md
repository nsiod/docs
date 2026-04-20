# NSC · 功能全景

> 本页是 NSC **当前实现**的精简索引。详细描述请到 [`docs/06-nsc-client/`](../06-nsc-client/index.md) 5 篇原文档。
>
> 数据基于 HEAD 2026-04-16。

## 1. 二进制与运行形态

| 项 | 现状 |
| --- | --- |
| 二进制 | `crates/nsc/` 单一可执行(`main.rs` + `vip.rs` + `dns.rs` + `router.rs` + `proxy.rs` + `http_proxy.rs`) |
| 安全 | 与 NSN 同一栈,`#![forbid(unsafe_code)]` |
| 异步运行时 | `tokio` 多线程 |
| 默认数据面 | `userspace`(VIP=`127.11/16`,WSS 中转)。可选 `wss`(语义与 userspace 等价)、`tun`(**仅换 VIP 前缀,未建 TUN**) |
| 控制面 | 默认 SSE(HTTP/1.1 over rustls) |
| 状态目录 | `/var/lib/nsio-nsc`(默认);内含 `machinekey.json` + `registrations/<realm>.json` |
| 日志 | stdout(默认) 或 `--log-dir /path`(JSON 每日轮转 `nsc.log`) |
| 终端输出 | 启动完成后 `println!` 一份 site → VIP → 域名表(`print_sites`) |

详见 → [06 · design.md](../06-nsc-client/design.md)

## 2. CLI 与启动

CLI 标志(节选,完整见 [06 · design.md §CLI / 启动与主循环](../06-nsc-client/design.md#启动与主循环)):

| 标志 / 环境变量 | 作用 |
| --- | --- |
| `--auth-key <k>` 或 `<realm>=<k>` | 首次注册的一次性 key,支持多 realm |
| `--device-flow` | OAuth2 device authorization 注册 (⚠️ 当前 `bail!` 未实现) |
| `--state-dir` / `STATE_DIR` | 机器状态目录(默认 `/var/lib/nsio-nsc`) |
| `--server-url` / `SERVER_URL` | 主 NSD URL |
| `--data-plane {userspace\|wss\|tun}` | 默认 `userspace` |
| `--dns-listen <addr:port>` | 默认 `127.53.53.53:53`,避让 systemd-resolved 的 `127.0.0.53` |
| `--http-proxy <addr:port>` | 可选:本地 HTTP/CONNECT 代理监听地址 |
| `--log-dir <dir>` | 开启 JSON 文件日志 |
| `nsc status` | ⚠️ 子命令目前只 `println!` 占位 |

启动主循环 14 步(简化,源码 `crates/nsc/src/main.rs`):

```
1. 解析 CLI / 初始化 tracing
2. MachineState::load_or_create(state_dir)  — machinekey
3. AuthClient::new(server_url, state)
   if !registered: register(auth_key) 或报错退出
4. ConnectorConfig → ControlPlane::new(...)
   拿到 8 个 receiver: wg_rx, proxy_rx, acl_rx, gw_rx,
                        routing_rx, dns_rx, control_status_rx, token_rx
5. VipAllocator::{new_userspace | new_tun}
6. Arc<RwLock<NscRouter>> + DnsRecords
7. spawn: dns::run_dns_server(records)
8. spawn: control.run()           — SSE + 鉴权 + 事件推送
9. ProxyManager::new(router, token="")
10. 可选 spawn: http_proxy::run_http_proxy(...)
11. 主循环 tokio::select! {
      routing_rx → router.update_routing
                 + allocator.allocate
                 + dns.insert(service_fqdn)
                 + proxy_mgr.update()
      gw_rx       → router.update_gateway
      dns_rx      → dns.insert(custom_domain)
    }
12. Ctrl-C / SIGTERM → runtime drop
```

> ⚠️ 启动时 `_wg_rx / _proxy_rx / _acl_rx / _token_rx` 用下划线**显式丢弃**,参见 [bugs ARCH-005 / FUNC-004 / SEC-006 / SEC-010](./bugs.md#2-架构问题-arch)。

## 3. 数据面三模式

CLI `--data-plane` 决定一切,但**真正分支只有 `VipAllocator` 初始化这一行**(`crates/nsc/src/main.rs:199`):

```rust
let mut allocator = match cli.data_plane {
    DataPlane::Tun => VipAllocator::new_tun(),              // 100.64/16
    DataPlane::Userspace | DataPlane::Wss => VipAllocator::new_userspace(), // 127.11/16
};
```

| | TUN | UserSpace | WSS |
| --- | --- | --- | --- |
| 需要 root | 是(要 TUN 设备) | 否 | 否 |
| VIP 段 | `100.64.0.0/16` | `127.11.0.0/16` | `127.11.0.0/16` |
| 捕获方式 | 内核路由到 TUN | 在 `VIP:port` 上 `bind()` | 同 userspace |
| WG 隧道 | 计划用 `tunnel-wg` | 否(WSS) | 否 |
| 当前实现 | **仅改 VIP 前缀** | **完整可用** | **与 userspace 行为一致** |
| 适用 | 路由型客户端 | 默认 | 防火墙严格 / UDP 被封 |

详见 → [06 · design.md §三种数据面模式](../06-nsc-client/design.md#三种数据面模式) / [06 · vip.md](../06-nsc-client/vip.md) 段选择与生命周期

## 4. VIP 分配(`127.11.0.0/16`)

`VipAllocator`(`crates/nsc/src/vip.rs:10`)。核心约束:

1. **幂等**:同一 site 名永远分配同一 VIP(内存 HashMap `assigned: site → Ipv4Addr`)。
2. **顺序**:`octet4: 1→254 → octet3+=1, octet4=1`,从 `.1` 起步跳过 `.0`。
3. **`/16` 池**:可用 ≈ 65 024 个 site,对客户端场景极其充裕。
4. **环回段隔离**:`127.11.x.x` 只在本机可见,不会跨主机冲突;本机已占用 `127.11.*` 概率极低,失败时 `TcpListener::bind` 报错且不影响其他 site。
5. **无持久化 / 无 eviction**:进程重启后 VIP 重新分配(顺序可能变);site 下线后 `NscRoute` 不清理。

TUN 模式选 `100.64.0.0/10`(RFC 6598 CGNAT 共享地址段),理由见 [06 · vip.md §为什么 TUN 选 100.64](../06-nsc-client/vip.md#为什么-tun-模式选-10064)。

## 5. DNS 监听与系统集成

`crates/nsc/src/dns.rs` 约 240 行,手写 wire format,**不依赖** `trust-dns-*`。

### 监听地址

```rust
pub const DNS_LISTEN_DEFAULT: &str = "127.53.53.53:53";
const UPSTREAM_DNS: &str = "1.1.1.1:53";
const UPSTREAM_TIMEOUT_SECS: u64 = 2;
```

`127.53.53.53:53` 的理由:

- 完全离开 `127.0.0.0/24`,不与 systemd-resolved(`127.0.0.53`)/ 传统 dnsmasq / mDNS 冲突
- `127.0.0.0/8` 整段默认路由到 `lo`,无须 `ip addr add`
- 端口 53 让 `/etc/resolv.conf` 零改写;若不想配 `cap_net_bind_service`,可切到 `:5353`

### 查询处理

| QTYPE | 行为 |
| --- | --- |
| 1 (A) / 255 (ANY) | 查 `DnsRecords`,命中返 A 记录(TTL=60s),否则转发上游 |
| 其他(AAAA / MX / TXT / SRV / ...) | 直接转发上游 |
| 压缩指针在 question | 直接报错 |

所有查询走 UDP ≤512B,每个查询 `tokio::spawn` 独立 task。

### 记录来源

1. **`routing_config` 自动派生**:每条 `RouteEntry` 把 `{service}.{site}.n.ns` 映射到已分配的 VIP(`crates/nsc/src/main.rs:258`)。
2. **`dns_config` 显式下发**:NSD 管理员配置的自定义域名(`git.company.com` 等),同样映射到 site 的 VIP(`crates/nsc/src/main.rs:279`)。
3. **大小写不敏感**:查询时 `to_lowercase`。

### 系统集成(需要用户/部署脚本)

| 方案 | 做法 | 适用 |
| --- | --- | --- |
| A. 并列(默认) | NSC 监听 `127.53.53.53:53`,加到 `/etc/resolv.conf` 首行 | 只让 `*.n.ns` 走 NSC |
| B. systemd-resolved 按域转发 | `resolvectl dns <iface> 127.53.53.53 / domain <iface> '~n.ns'` | 完全由 systemd-resolved 主导 |
| macOS | `sudo ifconfig lo0 alias 127.53.53.53 up` + `/etc/resolver/n.ns` 写入 nameserver | 非 `127.0.0.1` 环回需 alias |

详见 → [06 · dns.md](../06-nsc-client/dns.md)

## 6. NscRouter(路由表 + 出站 NAT)

`crates/nsc/src/router.rs:56`。主循环持有 `Arc<RwLock<NscRouter>>`,proxy / HTTP 代理 / DNS 三方读写共享。

```rust
pub struct NscRouter {
    sites_by_name:  HashMap<String, SiteInfo>,          // "office" → {vip, domain}
    sites_by_vip:   HashMap<IpAddr, String>,            // 127.11.0.1 → "office"
    routes:         HashMap<(String, u16), NscRoute>,   // ("office", 22) → NscRoute
    gateways:       HashMap<String, (String, String)>,  // "gw-1" → (wss, wg)
    primary_gateway_id: Option<String>,
}
```

更新入口:

| 方法 | 触发 | 行为 |
| --- | --- | --- |
| `update_routing(&RoutingConfig, &mut VipAllocator)` | `routing_rx` 事件 | 幂等 allocate + 插 site + 插 route |
| `update_gateway(&GatewayConfig)` | `gw_rx` 事件 | **全量替换** gateways;刷新**所有已有 route** 的 gateway 字段 |

查询接口:

| 方法 | 使用方 |
| --- | --- |
| `resolve(vip, port) → NscRoute` | VIP listener(`proxy.rs:142`)连接时解析 |
| `lookup_domain(&domain) → SiteInfo` | HTTP 代理 `resolve_target` |
| `open_stream(site, host, port) → WssStream` | VIP listener + HTTP 代理共用,封装"选 primary gateway + WSS + `CMD_OPEN_V4`" |
| `route_snapshots()` | `ProxyManager::update` 启动 TCP listener |
| `status_snapshot()` | `print_sites` 输出 |

**Lazy binding**:`NscRoute` 是**每次新 TCP 连接到达时**从 router 读取(`proxy.rs:144`),不是 listener 启动时快照;因此 gateway 切换后新连接立即用新 gateway,旧连接继续跑。

详见 → [06 · router.md](../06-nsc-client/router.md)

## 7. VIP Proxy(默认入口)

`crates/nsc/src/proxy.rs`。`ProxyManager::update` 遍历 `route_snapshots()`,为每个 `(VIP, port)` 启动一个 `TcpListener`:

- 一个 `(VIP, port)` 只起一个 listener;
- 现有 listener **不会被停止**(`listeners.contains_key(&key)` 直接 `continue`),这意味着 site 下线后 listener 不释放(泄漏但无害,`/16` 池足够大);
- 连接到达后 `router.resolve(vip, port)` → `NscRouter::open_stream` → `copy_bidirectional`。

连接分支(`proxy.rs:142`):

```rust
match router.resolve(vip, port).cloned() {
    Some(r) if !r.gateway_wss.is_empty() => { /* 正常走 WSS */ }
    Some(_) => warn!("no gateway configured yet — dropping connection"),
    None    => warn!("no route found for connection"),
}
```

## 8. HTTP 代理(可选)

`crates/nsc/src/http_proxy.rs`。由 `--http-proxy 127.0.0.1:8080` 开启。

支持请求形态:

```
CONNECT foo.n.ns:22 HTTP/1.1       ← HTTPS / SSH / 任意 TCP 的隧道入口
GET http://foo.n.ns/path HTTP/1.1  ← 明文 HTTP 转发
POST / PUT / DELETE / HEAD / OPTIONS / PATCH 同上
其他方法 → 405 Method Not Allowed
```

`resolve_target` 三级优先:

1. `NscRouter::lookup_domain(host)` 命中 → `Target::Tunnel { site, host, port }` → 直接调 `open_stream`(**不经过** VIP listener,零回环跳)
2. host 是字面 IP → OS 直连
3. 否则 `tokio::net::lookup_host` → 公网直连

与 VIP listener 的对比:

| 入口 | 启动门槛 | 目标表达能力 | 下游 |
| --- | --- | --- | --- |
| VIP listener(`127.11.x.x:port`) | 需预先为 `(site, port)` 分配 listener | 仅预分配过的端口集合 | `open_stream` → WSS |
| HTTP 代理(`127.0.0.1:8080`) | 单 listener 通吃所有 `(host, port)` | 任意 host/port(含非 n.ns 的直连 fallback) | 命中 NSC → `open_stream` → WSS;未命中 → OS 直连 |

两者共用 `NscRouter` 路由决策,但各自独立打 WSS 流。

详见 → [06 · http-proxy.md](../06-nsc-client/http-proxy.md)

## 9. 鉴权

复用 `control::auth::AuthClient`。状态目录 `/var/lib/nsio-nsc` 下:

```
machinekey.json              # Ed25519 + X25519,全局身份(明文 hex JSON,见 bugs SEC-004)
registrations/               # 每个 realm 一份
  <realm>.json
```

首次启动必须 `--auth-key key-xxx` 或 `--auth-key realm=key-xxx`(可重复)。`--device-flow` 当前**未实现**,`main.rs:172` 直接 `anyhow::bail!("--device-flow is not yet implemented in nsc")`(见 [bugs FUNC-002](./bugs.md#func-002))。

## 10. 与 NSN 的对照

| 维度 | NSN | NSC |
| --- | --- | --- |
| 定位 | 站点侧暴露服务 | 客户端侧访问服务 |
| 流量方向 | 入站(接收) | 出站(发起) |
| WG 角色 | 服务端 peer | 客户端 peer(TUN 模式,未实现) |
| 隧道入口 | NSGW → NSN | NSC → NSGW |
| NAT 类比 | DNAT(端口 → 服务) | SNAT + PAT(VIP → site+port) |
| smoltcp 角色 | 解析入站 IP 包 | (TUN 模式)解析回包 |
| TUN 角色 | 接收解密后的包 | 捕获出站包 |
| ACL | 按 src/dst 过滤入站 | 按 dst service 过滤出站(**未实现**) |
| 服务来源 | 本地 `services.toml` | 从 NSD SSE 自动发现 |
| 状态端点 | `/api/*` + `/api/metrics`(11 条) | 无 |

数据面组件(gotatun / smoltcp / ACL / proxy)可复用,但方向相反。

## 11. 依赖清单

NSC 依赖的内部 crate(与 NSN 高度重叠):

```
nsc → common (MachineState / services / system_info)
   ├→ control (SSE / Noise / QUIC / messages / device_flow)
   ├→ auth (AuthClient)
   ├→ acl (AclEngine — 目前引入但未使用)
   ├→ tunnel-wg (TUN 模式占位)
   ├→ tunnel-ws (WsFrame / WssStream)
   ├→ transport
   ├→ proxy (copy_bidirectional 等)
   └→ telemetry (依赖,但 NSC 未初始化 OTel,无 /metrics)
```

外部依赖关键项:`tokio` / `clap` / `tracing` / `serde` / `anyhow` / `rustls` / `webpki-roots`。

## 12. 测试矩阵

- 单元测试覆盖 VIP 段/顺序/回绕、router 幂等、DNS wire format
- 没有独立的 NSC E2E Docker 场景(NSN 有 4 套:WG / WSS / Noise / QUIC);NSC 场景通过 `nsn + nsc` 联合 compose 间接覆盖

## 13. 当前实现状态速览

| 能力 | 状态 |
| --- | --- |
| userspace 模式 + WSS relay | ✅ 可用 |
| `127.11.0.0/16` 分配 + 本地 DNS | ✅ 可用 |
| `--http-proxy` | ✅ 可用 |
| `--dns-listen` 可配置 | ✅ 可用 |
| SSE: routing / gateway / dns | ✅ 消费 |
| SSE: wg / proxy / acl / token_refresh | ⚠️ 接收但忽略(`_` 显式丢弃) |
| TUN 数据面 | ❌ 仅改了 VIP 前缀,未建 TUN 设备 |
| WSS-only 强约束 | ⚠️ 当前与 userspace 等价 |
| `nsc status` 子命令 | ⚠️ 仅打印占位字符串 |
| `--device-flow` | ❌ 直接报错退出 |
| ACL 出站过滤 | ❌ 未连 |
| `/metrics` 端点 | ❌ 无 |

---

更详细的功能展开请按需打开:

- [06 · design](../06-nsc-client/design.md) — NSC 架构 / 与 NSN/NSD 的关系 / 主循环
- [06 · vip](../06-nsc-client/vip.md) — `127.11.0.0/16` 段选择 / 生命周期 / 冲突处理
- [06 · dns](../06-nsc-client/dns.md) — 监听点选择 / 解析链路 / wire format
- [06 · router](../06-nsc-client/router.md) — `NscRouter` 数据结构 / 事件驱动更新
- [06 · http-proxy](../06-nsc-client/http-proxy.md) — `CONNECT` / 明文 `GET` / 目标分流
