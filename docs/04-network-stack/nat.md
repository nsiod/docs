# nat — ServiceRouter + 报文级 NAT

> 源码：`crates/nat/src/` — `lib.rs` / `router.rs` / `packet_nat.rs`
> 内部依赖：`acl`、`common`、`control`、（外部）`gotatun`、`dashmap`、`bytes`

`nat` crate 对外提供两个不同抽象层面的能力：

1. **`ServiceRouter`**（`router.rs`）— **连接级**的查表 + ACL + DNS 解析器，供 proxy 层在拿到 `NewTcpConnection` / HTTP Host / TLS SNI 时决定「该连哪个后端」。
2. **`HybridNatSend` / `HybridNatRecv`**（`packet_nat.rs`）— **报文级**的 NAT 改写器，实现 TUN 模式下的 DNAT + SNAT + 反向重建，配套 `DashMap` 构成的 `ConntrackTable`。

两者在 UserSpace 模式下只会用到 `ServiceRouter`；TUN 模式下两者都在工作流中：先走 `HybridNatSend`（本地服务）或经它再入 `netstack`（远端服务），回程经 `HybridNatRecv` 反解。

## 对外 API

```rust
// crates/nat/src/lib.rs:17-22
pub mod packet_nat;
pub mod router;
pub use packet_nat::{ConntrackTable, HybridNatRecv, HybridNatSend, new_conntrack};
pub use router::{ResolvedService, ServiceRouter};
```

| 类型 | 位置 | 用途 |
|------|------|------|
| `ServiceRouter` | `router.rs:38` | 单例，内部 `RwLock<Arc<ServicesConfig>>` + `RwLock<Option<Arc<AclEngine>>>`。 |
| `ResolvedService` | `router.rs:19` | 查表结果：`target: SocketAddr`、`fqid`、`tunnel`、`gateway`、`is_local`。 |
| `ConntrackTable` | `packet_nat.rs:78` | `Arc<DashMap<ConntrackKey, ConntrackVal>>` newtype；`HybridNatSend` 写、`HybridNatRecv` 读。 |
| `HybridNatSend<S: IpSend>` | `packet_nat.rs:192` | 包装 `gotatun::tun::IpSend`，在发送侧分流 local / remote / drop。 |
| `HybridNatRecv<R: IpRecv>` | `packet_nat.rs:343` | 包装 `gotatun::tun::IpRecv`，合并 TUN 回包与 smoltcp 出向包。 |

## ServiceRouter —— 连接级路由

### 输入维度

`services.toml` 里每个 `[services.NAME]` 对应一个 `ServiceDef`（在 `common` crate 定义），字段包括 `protocol: Protocol`、`host: String`、`port: u16`、`domain: Option<String>`、`enabled: bool`、`tunnel: TunnelPreference`、`gateway: GatewayPreference`。`ServicesConfig::find_named_by_*` 提供三种查法：

- `find_named_by_port(port, proto)` — 按 L4 端口 + 协议（仅 `enabled=true`）。
- `find_named_by_domain(host)` — 按 HTTP `Host` 头。
- `find_named_by_sni(sni)` — 按 TLS SNI。

三者都返回 `(&name, &ServiceDef)`。`ServiceDef::fqid(name, node_id)` 组装 `{name}.{node_id}.n.ns` 的全限定 ID，用于日志与监控输出（见 `crates/nat/src/router.rs:80`）。

### 决策流程

以 `resolve` 为例（`crates/nat/src/router.rs:71-111`）：

[ServiceRouter::resolve 决策流程](./diagrams/router-resolve.d2)

- **ACL 顺序**：先查服务白名单，再过 ACL。这保证 ACL 规则面向「已存在的服务」，减少 `dst_port` 未定义时的 debug 日志噪音。
- **DNS 解析**：`resolve_host`（`crates/nat/src/router.rs:204-215`）优先把 `host` 解析为 IP；否则走 `tokio::net::lookup_host`。解析失败静默返回 `None`，但会写 `tracing::warn!` —— 这是故意的：调用方 `relay_*` 在得到 `None` 后只能断开连接，不必 bubble 具体原因。
- **两个 HTTP 变体**（`resolve_by_host` / `resolve_by_sni`，`router.rs:117` / `router.rs:162`）：端口固定 `80` / `443`，其余与 `resolve` 一致；专用于 proxy 层在读到 HTTP Host / TLS ClientHello 后做第二轮路由。

### 为什么锁要先 drop 再 await

`ServicesConfig` 读锁与 `AclEngine` 读锁都会在进入 `resolve_host(.., ..).await` 之前显式 `drop`（`crates/nat/src/router.rs:86` / `router.rs:101`），避免 tokio 任务在 `.await` 期间长期持有 `RwLockReadGuard`，防止跨任务写侧饥饿。

## HybridNatSend —— 报文级 NAT（TUN 模式核心）

`HybridNatSend` 包装任何实现 `gotatun::tun::IpSend` 的底层设备（在生产中是真正的 TUN 设备），对每个要发出的 `Packet<Ip>` 做：

```text
1. parse_five_tuple   → 非 IPv4/TCP/UDP 直接丢弃 (return Ok(()))
2. ACL check          → is_allowed==false 记 debug 后丢弃
3. find_named_by_port → 未匹配任何服务 → 丢弃
4. is_local ?         → local: DNAT+SNAT+conntrack→内核 TUN
                        remote: 原包送 proxy_tx → smoltcp 路径
```

关键代码位于 `crates/nat/src/packet_nat.rs:225-330`。

### 决策树

[HybridNatSend 决策树](./diagrams/hybrid-nat-decision.d2)

### DNAT + SNAT 细节

- **DNAT**：把 dst IP 改成 `svc.host.parse::<Ipv4Addr>()`，dst port 改成 `svc.port`。`svc.host` 必须是 IPv4 字面量（通常是 `127.0.0.1`）；不支持在包级做 DNS，否则每个包都要走一次异步解析（`packet_nat.rs:275-278`）。
- **SNAT**：把 src IP 改成 `tun_ip`，这是 **关键点**——服务看到连接来自 `tun_ip`，回包也会被内核路由回 TUN 接口，从而被 `HybridNatRecv` 抓到。如果跳过 SNAT，回包会走真实物理接口，绕过 NSN 的加密通道。
- **conntrack key 构造**（`packet_nat.rs:297-310`）：key 是**反向包的五元组**，即 src=real_ip:real_port, dst=tun_ip:peer_src_port；value 保存要恢复的原始 src/dst。这样 `HybridNatRecv` 看到服务回包时，直接用自己的五元组做 key 查表即可。
- **checksum 重算**：IPv4 头校验和 (`recalc_ip_checksum`, `packet_nat.rs:149`) 与 TCP/UDP 校验和 (`recalc_transport_checksum`, `packet_nat.rs:158`) 都是经典的 one's-complement 实现，后者带 IPv4 伪首部。两次校验和必须都算，因为 SNAT/DNAT 都会改动伪首部里的 IP 字段。
- **Packet 重建**：改完 buf 后用 `Packet::from_bytes(BytesMut::from(&buf[..])).try_into_ip()?` 把字节数组重新包成 `Packet<Ip>`。`try_into_ip` 失败会返回 `io::Error`（`packet_nat.rs:319`），上游决定是否继续运作。

### Remote 服务为何走 proxy_tx

`svc.is_local() == false` 表示目标在另一台机器（如 `192.168.0.5:80`、内网数据库等）。这类报文不能直接丢给内核 TUN——内核会按主机路由表转发，**绕过 NSN 与 NSGW 的代理通道**，控制面与 ACL 就都失效了。所以 `HybridNatSend` 把原包（不改头）送进 `proxy_tx`，对端是一个连接到 `netstack::NetStack::poll` 的 `inject_rx` 通道：

```text
gotatun → HybridNatSend → proxy_tx → netstack (smoltcp)
                                  → ServiceRouter.resolve → proxy.connect(真实后端)
```

也就是说 TUN 模式对**本地**服务零 TCP 状态机（走内核栈）、对**远端**服务仍然复用 UserSpace 模式那一整套 smoltcp+proxy 流水线。

## HybridNatRecv —— 反向路径聚合

`HybridNatRecv` 同时从两个源读取要交给 `gotatun` 加密的 `Packet<Ip>`：

1. **inner TUN 设备**：本地服务（例如 `127.0.0.1:22` 的 sshd）回包走这里，先通过 `apply_reverse_nat` 查 conntrack 把 src/dst 恢复成「TUN 虚拟 VIP → 对端虚拟 IP」，再算校验和。
2. **smoltcp 出向通道 `smoltcp_rx`**：远端服务由 smoltcp 组装的回包走这里，已经携带正确的 src/dst，不再做 NAT。

实现见 `crates/nat/src/packet_nat.rs:396-447`：

- `tokio::select!` 同时等 `inner.recv(pool)` 和 `smoltcp_rx.recv()`。两条路径互斥 —— 单个 `recv` 调用只返回一路的数据。
- 一旦 `smoltcp_rx` 返回 `None`（通道永久关闭），设置 `self.smoltcp_rx = None`，后续调用回退到「仅 TUN」路径，避免 `select!` 被已关闭通道反复唤醒形成忙循环（`packet_nat.rs:406-437`）。
- `mtu()` 直接委托给内层（`packet_nat.rs:449`）。

### 反向 NAT 的"静默丢弃"语义

`apply_reverse_nat`（`crates/nat/src/packet_nat.rs:364`）在 conntrack 里查不到对应 entry 时返回 `None`，`filter_map` 会把这些包从迭代器里丢掉 —— **不写日志、不返回错误**。这是故意的设计：未授权来源的包本就不该能路由到 TUN，沉默丢弃防止攻击者通过频繁 ping 探测 conntrack 状态。相应地，调试时需要在 `HybridNatSend::send` 一侧打开 `tracing::debug` 才能确认 NAT 路径是否工作。

## ConntrackTable

```rust
// crates/nat/src/packet_nat.rs:53-83
struct ConntrackKey { proto: u8, src_ip: Ipv4Addr, src_port: u16, dst_ip: Ipv4Addr, dst_port: u16 }
struct ConntrackVal { new_src_ip, new_src_port, new_dst_ip, new_dst_port }

pub struct ConntrackTable(Arc<DashMap<ConntrackKey, ConntrackVal>>);
pub fn new_conntrack() -> ConntrackTable { ... }
```

- 用 `DashMap` 而不是 `HashMap + Mutex`：DNAT 写与反向 NAT 读高度并发（WG 收发两侧各自跑在独立 tokio 任务），DashMap 的分片锁降低竞争。
- **目前没有过期回收**（源码里找不到 eviction 逻辑）。长周期运行时 conntrack 条目只增不减，是已知的权衡；如果要上生产需要在上层加定时清理，或者让 `HybridNatSend` 在观察到 RST/FIN 时主动 `remove`（当前代码不做，依赖内核本身的 TCP timewait 回收）。见 [tun-vs-userspace.md](./tun-vs-userspace.md) 的「遗留事项」。

## 辅助：parse_five_tuple / checksum

- `parse_five_tuple`（`crates/nat/src/packet_nat.rs:100-123`）：只认 IPv4 + TCP/UDP；ICMP / IPv6 / 截断包一律返回 `None`。五元组里额外带 `ihl`（IP 首部字节长度），NAT 流程里直接用它定位 L4 头。
- `ones_complement_sum` / `fold_carry`（`packet_nat.rs:128-146`）：标准 RFC 1071 one's-complement 折叠，对奇数字节做零填充。
- `recalc_transport_checksum` 读 `total_len` 字段推断 segment 范围；若 `total_len` 越界，安静返回（`packet_nat.rs:167`）。对 ICMP / IGMP / 其他协议 `cs_offset = ihl+...` 的匹配会落进 `_ => return`，静默跳过（`packet_nat.rs:164`）。

## 测试覆盖

- `router.rs` 底部 5 个 tokio 测试覆盖：已知端口返回、未知端口 `None`、禁用服务 `None`、协议不匹配 `None`、完整 `tunnel/gateway/fqid` 字段回传（`crates/nat/src/router.rs:248-324`）。
- `packet_nat.rs` 底部 7 个同步测试覆盖：IP 校验和 round-trip、TCP 校验和 round-trip、local SNAT 覆写、reverse NAT 恢复、无 conntrack 时 `apply_reverse_nat` 返回 `None`、UDP 校验和随头变动、ICMP 报文被丢弃（`crates/nat/src/packet_nat.rs:494-677`）。
- ACL 被拒绝的路径未单独在 `nat` crate 测试，而是靠 `acl` crate 的 policy 测试 + 集成 E2E 覆盖。

## 与上下游的契约

| 上下游 | 位置 | 约定 |
|-------|------|------|
| `acl::AclEngine::is_allowed` | `router.rs:96` / `packet_nat.rs:250` | 调用方传 `AccessRequest { src_ip, dst_ip, dst_port, protocol }`；返回 `Decision { allowed, .. }`。`allowed=false` 一律静默丢弃并 `tracing::debug` 记录。 |
| `common::ServicesConfig` | `router.rs:78` | 只读视图，通过 `RwLock<Arc<...>>` 实现热替换；替换逻辑在 `control` crate 的 policy 合并器里。 |
| `gotatun::tun::{IpSend, IpRecv}` | `packet_nat.rs:225` / `packet_nat.rs:396` | `HybridNat*` 通过泛型 `S: IpSend` / `R: IpRecv` 耦合；实际实现来自 `tunnel-wg::TunDevice`。 |
| `tunnel-wg` | `crates/tunnel-wg/src/lib.rs:383-391` | 持有 `ConntrackTable`，把它同时传给 `HybridNatSend::new` 与 `HybridNatRecv::new`，保证正反两个方向看到同一张表。 |
| `netstack::NetStack::poll` | 本目录 [netstack.md](./netstack.md) | 远端服务路径：`proxy_tx` 的 receiver 就是 netstack 的 `inject_rx`。 |

## 常见坑位

1. **`svc.host` 不是 IPv4 字面量时 TUN 路径会 silent-skip**（`packet_nat.rs:275`）。本地服务请把 `host = "127.0.0.1"` 写死；用 domain 的本地服务需先用 `resolve_by_host` 把它归到 UserSpace 路径。
2. **conntrack 无过期**（上文）。短连接风暴会使 DashMap 增长，需要上层监控 `/api/nat` 对应的条目数（`architecture.md` 提到的 `/api/nat` 路由）。
3. **UDP 静默 drop**：当 conntrack 不命中时 `apply_reverse_nat` 返回 `None`；`filter_map` 丢弃。如果 `HybridNatSend` 的写入比 TUN 侧回包更慢，窗口期内的 UDP 响应会被静默丢掉。生产中需要观察 UDP 丢包率来判断是否要增大 mpsc buffer。
4. **checksum offset 硬编码 TCP/UDP**（`packet_nat.rs:162`）：添加新协议（SCTP、DCCP 等）需要扩展此处，目前无扩展点，写清楚了是刻意限制。
5. **ACL 锁是 `std::sync::RwLock`**，不是 `tokio::sync`（`packet_nat.rs:195`）。因为 `HybridNatSend::send` 是 `async fn`，但 ACL 检查耗时极短，持锁期间不会 `.await`，直接用 std 锁避免 contention。若未来 ACL 变成异步就要改回 tokio 锁，否则会 block executor 线程。
