# Virtual IP 分配

> 关注：段选择、分配算法、生命周期、冲突处理、与 TUN 模式的差异。

## 段选择

NSC 为每个远端 site 分配一个本地 IPv4 地址作为「落地点」。不同数据面模式使用不同前缀：

| 模式 | 前缀 | 掩码 | 理由 |
|---|---|---|---|
| userspace（默认） | `127.11.0.0` | `/16` | 环回段，无需 root、无需路由、无需 TUN 设备。Linux `127.0.0.0/8` 整段都是回环，`bind()` / `connect()` 可直接用 |
| wss | `127.11.0.0` | `/16` | 与 userspace 共用 |
| tun | `100.64.0.0` | `/16` | RFC 6598 CGNAT 共享地址段，内核路由到 `tun0`；NSC 和 NSGW 侧双向使用同一段 |

定义见 `crates/nsc/src/vip.rs:19`：

```rust
pub fn new_userspace() -> Self { Self::with_prefix([127, 11]) }
pub fn new_tun() -> Self       { Self::with_prefix([100, 64]) }
```

### 为什么选 `127.11`？

- `127.0.0.0/8` 整段在 Linux/BSD/macOS 上默认可用于环回，无须单独 `ifconfig alias`。
- `127.0.0.1` 是默认 localhost;`127.0.0.53` 被 systemd-resolved 占用;NSC 自身 DNS 默认用 `127.53.53.53`(见 [dns.md](./dns.md#监听地址)),都在 VIP 段 `127.11/16` 之外,不会和 site VIP 冲突。
- 选 `.11` 是 NSIO 内部约定（mnemonic：第 2 位对应 "NS" 的字母序），没有技术约束——只要落在 `127.0.0.0/8` 内且和本机其他服务不冲突即可。
- 完整 `/16` 段有 65 536 个地址；allocator 在每个 `/24` 段内只用 `.1`–`.254`（`.0` 被跳过，`.255` 由回绕规则跳过），实际容量 ≈ 65 024 个 site，对客户端同时连接的 site 数极其充裕。

### 为什么 TUN 模式选 `100.64`？

- 环回地址**不能**作为 TUN 设备的地址（内核会拒绝把 `127.0.0.0/8` 挂到非 `lo` 设备）。
- `100.64.0.0/10` 是 [RFC 6598](https://datatracker.ietf.org/doc/html/rfc6598) 分配的 **CGNAT 共享地址段**（Shared Address Space），专为运营商 / 覆盖网络之间的非公网转接而设，**不应出现在任何企业或家庭 LAN**。相比 RFC 1918（`10/8` · `172.16/12` · `192.168/16`），与用户本机已有网段冲突的概率极低。
- 这也是 Tailscale、NetBird 等覆盖网方案选用的同一段 —— 与既有生态一致，便于 NSC 和 NSGW 的 WG 隧道子网协调（见 `/app/ai/nsio/docs/architecture.md`）。
- `ip route add 100.64.0.0/16 dev tun0` 之后由内核按普通单播转发。

## 分配算法

结构体 `VipAllocator`（`crates/nsc/src/vip.rs:10`）：

```rust
pub struct VipAllocator {
    prefix: [u8; 2],
    octet3: u8,
    octet4: u8,
    assigned: HashMap<String, Ipv4Addr>,
}
```

- `octet3` / `octet4` 是下一个将要分发的地址；
- `assigned` 记录 site → 已分配 VIP，保证**幂等**：同一个 site 名字只分一次 VIP。

`allocate()` 的三条规则（`crates/nsc/src/vip.rs:38`）：

1. 若 site 已有 VIP，直接返回已有的；
2. 否则组装 `prefix[0].prefix[1].octet3.octet4`；
3. 记录到 `assigned` 并推进计数器。

推进规则（`crates/nsc/src/vip.rs:48`）：

```
octet4: 1 → 2 → ... → 254 → octet3 += 1, octet4 = 1
octet3: u8 自然回绕（wrapping_add），耗尽约 65 024 个地址后会回到起点
```

从 `.1` 开始而不是 `.0`，目的是跳过网络地址位（`*.*.*.0`）。`.255` 广播位**没有**显式跳过——在 `/16` 段里这是次要问题，被跳过的只有每条子网的 `.0`。

### 分配顺序

```
1st  site  →  127.11.0.1
2nd  site  →  127.11.0.2
...
254th site →  127.11.0.254
255th site →  127.11.1.1       (octet4 回到 1，octet3 +1)
```

单元测试覆盖了这些边界（见 `crates/nsc/src/vip.rs:62`），包括：

- `userspace_prefix_is_127_11` / `tun_prefix_is_100_64` — 段正确；
- `same_site_gets_same_vip` — 幂等；
- `different_sites_get_different_vips` — 冲突避免；
- `first_vip_ends_in_0_1` — 起始地址；
- `vips_increment_sequentially` — 顺序；
- `octet4_wraps_to_next_octet3` — 边界回绕。

## 生命周期

[VIP 分配时序](./diagrams/vip-allocation.d2)

几个关键属性：

- **持久化**：不做。VIP 只存在于内存（`HashMap<String, Ipv4Addr>`），进程重启后重新分配，顺序取决于 SSE 首条 `routing_config` 里 routes 的顺序。
- **刷新**：每次 SSE 推送 `routing_config`，NSC 会对每条 route 再调 `allocator.allocate(site)`——已有 site 幂等返回原 IP，新 site 才分配新 IP。不存在「释放」路径：被删除的 site 的 VIP 留在内存但不会有 proxy listener 重连，实际上是**泄漏但无害**（`/16` 池子足够大）。
- **DNS 名字是稳定的**：由 NSD 分配的 site id / nanoid 决定，重启后同一 site 会拿到**不同的 VIP** 但**相同的域名**——因此用户工具里**不要**硬编码 VIP，只用 `*.n.ns` 域名。
- **Proxy listener 绑定**：`ProxyManager::update` 根据 `router.route_snapshots()` 启动 `TcpListener`（见 `crates/nsc/src/proxy.rs:79`）。一个 (VIP, port) 只起一个 listener；现有 listener **不会**被停止（`listeners.contains_key(&key)` 直接 `continue`）。

## 冲突处理

NSC 不做全局冲突检测，依赖两点约束：

1. **环回段的天然隔离**：`127.11.x.x` 只在本机可见，其他机器不可达，因此不会有跨主机冲突。
2. **本机已占用 `127.11.*`**：几乎为零概率，但若用户在本机另开了服务绑到 `127.11.0.1`，`proxy.rs` 里 `TcpListener::bind(addr)` 会失败并记录错误（`crates/nsc/src/proxy.rs:99`），该 site 对应端口连不通——其他 site 不受影响。
3. **TUN 模式下的路由冲突**：若用户本机已有 `100.64.0.0/16` 的静态路由（其他 CGNAT 覆盖网如 Tailscale 等），NSC 的 TUN 设备会抢占。这种场景目前无显式检测，需通过 `--data-plane userspace` 回退。

## 为什么不用 `localhost:random_port`？

一个典型的替代方案是把所有 service 都代理到 `127.0.0.1` 的不同端口（类似 kubectl port-forward）。NSC 没这么做，原因：

- **同名服务冲突**：多个 site 都暴露 `ssh:22`，用户希望 `ssh ssh.officeA.n.ns` 和 `ssh ssh.officeB.n.ns` 都能通过标准 22 端口——用 VIP 可以保留服务端的**原始端口**，用不同的 IP 区分 site。
- **DNS 语义统一**：`*.n.ns` 解析到一个 IPv4 地址是标准 DNS 行为；如果解析到 `(ip, port)` 对需要 SRV 记录，绝大多数客户端不支持。
- **端口号是协议语义的一部分**：SSH 客户端若看到端口不是 22 会要求显式 `-p`，很多自动化脚本会崩。

## 代码引用

- 数据结构：`crates/nsc/src/vip.rs:10`
- 构造器：`crates/nsc/src/vip.rs:19` (userspace) / `crates/nsc/src/vip.rs:24` (tun)
- 分配主函数：`crates/nsc/src/vip.rs:38`
- 推进逻辑：`crates/nsc/src/vip.rs:48`
- 主循环调用：`crates/nsc/src/main.rs:254` (`r.update_routing(&routing, &mut allocator)`)
