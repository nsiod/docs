# 03 · 数据面（Data Plane）

NSN 的数据面由三组 crate 协作完成：**"怎么连"**（`connector`）决策传输模式与网关；**"怎么送"** 分别由 [`tunnel-wg`](./tunnel-wg.md)（WireGuard 用户态隧道）与 [`tunnel-ws`](./tunnel-ws.md)（WSS 多路复用中继）实现。再加上 [`transport-fallback.md`](./transport-fallback.md) 描述的 UDP↔WSS 自动切换，它们共同构成 NSN 对 NSGW 的"双通道、可降级、多网关"数据路径。

本目录只覆盖"报文进出 NSN 的那段"；进入 NSN 之后的 netstack 处理（smoltcp、NAT、ACL 评估点）参见 [`../04-network-stack/`](../04-network-stack/)，上层 `ServiceRouter` 与 services.toml 见 [`../05-proxy-acl/`](../05-proxy-acl/)。

---

## 文档索引

| 文档 | 范围 | 关键源码 |
|---|---|---|
| [`tunnel-wg.md`](./tunnel-wg.md) | gotatun Device、UAPI、动态 peer、TUN/UserSpace 双模式 | `crates/tunnel-wg/src/lib.rs:117` |
| [`tunnel-ws.md`](./tunnel-ws.md) | WsFrame 二进制协议、单连接多路复用、relay tasks | `crates/tunnel-ws/src/lib.rs:279` |
| [`connector.md`](./connector.md) | `ConnectorManager` + `MultiGatewayManager`、选路策略、健康状态机 | `crates/connector/src/lib.rs:67` / `multi.rs:152` |
| [`transport-fallback.md`](./transport-fallback.md) | `auto` 模式决策、3x UDP → WSS fallback、300s WSS→UDP upgrade | `crates/connector/src/lib.rs:205` |
| [`diagrams/wg-tunnel.d2`](./diagrams/wg-tunnel.d2) | gotatun 报文流 + UAPI 状态上报 | d2 graph |
| [`diagrams/ws-tunnel.d2`](./diagrams/ws-tunnel.d2) | WsFrame 编解码 + 多路复用 | d2 graph |
| [`diagrams/connector-multi.d2`](./diagrams/connector-multi.d2) | 多 NSGW 并发 + 健康状态机 | d2 flowchart |
| [`diagrams/fallback.d2`](./diagrams/fallback.d2) | UDP/WSS 切换时序 | d2 sequence |

---

## 数据面鸟瞰

```
                    ┌─────────────────────────────────────────────┐
                    │                    NSN                      │
                    │                                             │
 control plane ──┬──▶│  WgConfig → TunnelManager (tunnel-wg)     │
  (SSE events)   │  │               │                             │
                 │  │               ▼                             │
 gateway_config ─┴──▶│        gotatun Device + UAPI              │
                    │               │          ▲                 │
                    │               ▼          │                 │
                    │    smoltcp / TUN ─── NsnIpSend/Recv        │
                    │                                             │
                    │  ┌──────────────────────────────────────┐  │
                    │  │  ConnectorManager  ConnectorManager  │  │
                    │  │   (nsgw-1)          (nsgw-2)         │  │
                    │  │   UDP probe x3        WSS direct     │  │
                    │  │        │                 │            │  │
                    │  └────────│─────────────────│────────────┘  │
                    │           │                 │               │
                    └───────────▼─────────────────▼───────────────┘
                                │                 │
                     UDP:51820  │        wss:443  │
                                ▼                 ▼
                          ┌──────────┐     ┌──────────┐
                          │  nsgw-1  │     │  nsgw-2  │
                          └──────────┘     └──────────┘
                                        │
                       MultiGatewayManager ← GatewayEvent 事件流
                                        │
                                        ▼
                              /api/gateways · gateway_report
```

三个责任边界：

| 责任 | 归属 | 不做什么 |
|---|---|---|
| **加/解密 WireGuard** | `tunnel-wg::TunnelManager` | 不决策用哪个 peer、不发探测包 |
| **复用 WSS 流** | `tunnel-ws::WsTunnel` | 不选网关、不做 UDP |
| **选路 + 切换 + 多网关状态** | `connector` | 不拆包、不碰 NAT |

---

## 关键机制速查

| 机制 | 位置 | 见 |
|---|---|---|
| WireGuard 动态 peer | `crates/tunnel-wg/src/lib.rs:218`（device rebuild）+ UAPI `GET` | [tunnel-wg §2](./tunnel-wg.md#2-uapi--动态-peer-管理协议) |
| WsFrame 字节布局 | `crates/tunnel-ws/src/lib.rs:86`（常量）`:140`（encode）`:183`（decode） | [tunnel-ws §2](./tunnel-ws.md#2-wsframe-二进制协议) |
| 3 次 UDP 探测 → WSS | `crates/connector/src/lib.rs:208` | [transport-fallback §2.1](./transport-fallback.md#21-udp--wss-fallback) |
| 300 s WSS → UDP 升级 | `crates/connector/src/lib.rs:327` | [transport-fallback §2.2](./transport-fallback.md#22-wss--udp-upgrade) |
| 多网关状态机 | `crates/connector/src/multi.rs:50` | [connector §2.1](./connector.md#21-gatewaystatus-状态机) |
| 选路策略（lowest_latency / round_robin / priority） | `crates/connector/src/multi.rs:84` | [connector §2.3](./connector.md#23-gatewaystrategy选路策略) |
| ACL / services 热更新 | `Arc<RwLock<Option<Arc<AclEngine>>>>` 指针共享 | [tunnel-ws §4.1](./tunnel-ws.md#41-热更新) |
| 每服务 transport 偏好 | `tunnel=wg/ws/auto`、`gateway=auto/specific` | [transport-fallback §3.2](./transport-fallback.md#32-每服务独立选路) |

---

## 与其它模块的关系

- **控制面输入**：`WgConfig`、`gateway_config`、`acl_policy`、`TokenRefresh` 都从 [`../02-control-plane/`](../02-control-plane/) 流入本目录的三个 manager。
- **解密后数据去向**：UserSpace 模式下进入 [`../04-network-stack/`](../04-network-stack/) 的 smoltcp + NAT；TUN 模式下本地服务走内核，远端服务仍经 smoltcp。
- **策略评估点**：`tunnel-ws::check_target_allowed` 和 `tunnel-wg::AclFilteredSend` 调用的是 [`../05-proxy-acl/`](../05-proxy-acl/) 中定义的 `AclEngine` 与 `ServicesConfig`。
- **系统级角色**：NSN 自身的位置与边界见 [`../01-overview/`](../01-overview/)；NSC 客户端消费同样的 `tunnel-ws`，具体形态在 [`../06-nsc-client/`](../06-nsc-client/)；NSN 节点级生命周期在 [`../07-nsn-node/`](../07-nsn-node/)。

---

## 交叉索引

- [`../01-overview/`](../01-overview/) —— 整体架构、NSD/NSGW/NSN/NSC 角色。
- [`../02-control-plane/`](../02-control-plane/) —— SSE 事件、config 注入。
- [`../04-network-stack/`](../04-network-stack/) —— smoltcp / NAT / 五元组处理。
- [`../05-proxy-acl/`](../05-proxy-acl/) —— ACL 引擎、services.toml、ServiceRouter。
- [`../06-nsc-client/`](../06-nsc-client/) —— NSC 客户端（轻量 `tunnel-ws` 用户）。
- [`../07-nsn-node/`](../07-nsn-node/) —— NSN 节点生命周期与服务启动。
- 上游参考：`/app/ai/nsio/docs/transport-design.md`, `/app/ai/nsio/docs/system-overview.md`。
