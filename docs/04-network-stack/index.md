# 04 · 网络栈模块 (netstack + nat)

NSN 数据面在接收到 gotatun 解密出的 IP 报文后，有两条可选通路：

- **UserSpace 模式（默认、无 root）** — 将报文喂入 `smoltcp` 用户态 TCP/IP 协议栈，`netstack` 完成 TCP 三次握手 / UDP 解封，再把建立好的连接交给 `ServiceRouter` 查询、ACL 放行、代理到后端。
- **TUN 模式（需要 `CAP_NET_ADMIN`）** — 直接由 `nat::HybridNatSend` 做 ACL + DNAT + SNAT，并通过内核 TUN 设备把报文投递给本机服务，避开用户态 TCP 状态机。

两条路径共享同一份 `ServicesConfig` / `AclEngine`，路由结果一致，仅差在「谁来终结 TCP」。

## 本目录文档

| 文档 | 内容 |
|------|------|
| [netstack.md](./netstack.md) | `smoltcp` `Device` trait 适配 (`VirtualDevice`) 与 `NetStack::poll` 主循环；TCP 监听 / UDP 直拦截；向 `ServiceRouter` 递交 `NewTcpConnection` / `NewUdpDatagram`。 |
| [nat.md](./nat.md) | `ServiceRouter` 查表 + ACL + DNS 解析；`HybridNatSend` / `HybridNatRecv` 的 DNAT + SNAT + `ConntrackTable` 报文改写流程；`local / intercept / drop` 决策树。 |
| [tun-vs-userspace.md](./tun-vs-userspace.md) | TUN vs UserSpace 两种数据面模式在能力要求、性能、兼容性、可观测性上的对比。 |
| [diagrams/netstack-flow.d2](./diagrams/netstack-flow.d2) | UserSpace 模式：gotatun 解密 → `VirtualDevice` → smoltcp → `ServiceRouter` → proxy。 |
| [diagrams/nat-dnat.d2](./diagrams/nat-dnat.d2) | TUN 模式 `HybridNatSend` 的 ACL + DNAT + local/intercept/drop 决策。 |
| [diagrams/modes.d2](./diagrams/modes.d2) | TUN 与 UserSpace 两种数据通路的俯视对比。 |

## 在整套架构中的位置

[04 网络栈在架构中的位置](./diagrams/overview-position.d2)

- 上游 `gotatun` 的输入由 [03 · 数据面](../03-data-plane/index.md) 描述；`netstack` 只消费已解密的 IP 报文字节。
- 命中代理路径的连接最终进入 [05 · proxy / ACL](../05-proxy-acl/index.md) 模块的 `relay_*_connection` 系列函数。
- `ServiceRouter` 所依赖的 `ServicesConfig` 由控制面下发，见 [02 · 控制面](../02-control-plane/index.md)。
- `nsn` 主进程里两条通路的装配代码在 [07 · NSN Node](../07-nsn-node/index.md) 的启动流程中。

## 源码入口

- `crates/netstack/src/lib.rs:1` — 模块说明与 `NetStack` / `NewTcpConnection` / `NewUdpDatagram` 再导出。
- `crates/netstack/src/device.rs:34` — `VirtualDevice` 的 `smoltcp::phy::Device` 实现。
- `crates/netstack/src/stack.rs:66` — `NetStack::poll` 主循环（TCP listener、UDP 直拦截、`tx_out` 回写）。
- `crates/nat/src/lib.rs:17` — `packet_nat` / `router` 模块再导出。
- `crates/nat/src/router.rs:71` — `ServiceRouter::resolve` 查表 + ACL + DNS 解析。
- `crates/nat/src/packet_nat.rs:225` — `HybridNatSend::send` 的逐包 NAT 实现。

## 关键不变量

1. **#![forbid(unsafe_code)]** — `netstack` (`crates/netstack/src/lib.rs:1`) 与 `nat` (`crates/nat/src/lib.rs:1`、`crates/nat/src/router.rs:1`) 全部禁用 `unsafe`。
2. **报文即真相** — `netstack` / `nat` 只看 IP/TCP/UDP 头，不做任何策略判断；ACL 策略、服务列表来自 `acl` / `common` 两个 crate。
3. **两条 NAT 路径共享一张 conntrack** — TUN 模式下 `HybridNatSend` 写入的 `ConntrackKey` 必须和 `HybridNatRecv` 反向查表时一致，否则响应包被静默丢弃（见 `nat::apply_reverse_nat`，`crates/nat/src/packet_nat.rs:364`）。
