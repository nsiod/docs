# 传输层设计: 为什么要四种协议

> 目标读者: 负责部署拓扑、网络对抗、以及"在什么网络环境下选哪个协议"的架构师。
>
> 本文回答"为什么控制面需要 SSE/Noise/QUIC 三种,数据面需要 WG/WSS 两种,而不是选一个统一的"。

## 分层: 控制面 vs 数据面

NSIO 把"传输"分成两个独立的层面,各自独立选型:

| 层面 | 承载内容 | 协议候选 | 选择方式 |
|------|---------|---------|---------|
| **控制面** | NSD → 各组件的配置推送(SSE 事件) | `sse` / `noise` / `quic` | NSN 启动参数 `--control-mode` |
| **数据面** | NSC ↔ NSN 的业务字节流 | `wg` / `wss` | 按**网关**独立选;由 `connector` 自动回退 |

这两层**没有必然关系**。例子:
- NSN 可以 `--control-mode=quic`(控制面抗 HTTPS 阻断)+ 业务走 `wg`(最优延迟)。
- NSN 可以 `--control-mode=sse`(普通 HTTPS)+ 业务强制 `wss`(防火墙只放 443)。

## 数据面: WG 和 WSS

### 协议对比

| 协议 | 层级 | 端口 | NAT 穿透 | 防火墙友好度 | 典型延迟 / 带宽 |
|------|------|------|---------|------------|----------------|
| **WireGuard** | UDP | 51820(可配) | 打洞 | 严格网络常被封 | 最优 |
| **WSS** | TCP/TLS | 443 | 无需打洞 | 几乎不可能被封 | TCP 队头阻塞 + TLS 开销 |
| WebRTC DataChannel(未来) | UDP(SCTP over DTLS) | 动态 | ICE(STUN/TURN) | 需要 UDP | 介于两者之间 |

### 自动回退

`connector::MultiGatewayManager` 对每个网关独立维护 WG 和 WSS 状态。回退策略:

[WG / WSS 自动回退状态机](./diagrams/wg-wss-fallback.d2)

关键源码:
- 多网关选路: `crates/connector/src/multi.rs:152`
- WG 隧道封装: `crates/tunnel-wg/src/lib.rs`
- WSS 隧道: `crates/tunnel-ws/src/lib.rs`

### 两跳独立选路

**关键观察**: NSC 和 NSN 所处网络环境**完全独立**。

```
NSC (咖啡馆 Wi-Fi)        NSGW (云 VPS)            NSN (企业办公室)
────────────────         ─────────────             ────────────────
UDP 被完全封锁           所有端口可用              入站 UDP 被防火墙封
↓                       ↓                        ↓
WSS 唯一选择            两种都能做              只能接受 TCP:443 入站
```

NSGW 作为**协议桥接器**,两侧独立决策:

```
NSC ──[WSS]──→ NSGW ──[WG]──→ NSN          (NSC 受限,NSN 自由)
NSC ──[WG]───→ NSGW ──[WSS]─→ NSN          (NSN 受限,NSC 自由)
NSC ──[WSS]──→ NSGW ──[WSS]─→ NSN          (两端都受限)
NSC ──[WG]───→ NSGW ──[WG]──→ NSN          (最优)
```

> 为什么不强制"全链路同一协议"?因为两端的网络环境没有任何关联 —— 假设它们相同会在现实部署中频繁误判。

### 数据面模式 (Data Plane)

数据面不仅是"用哪个协议",还包括"包到达 NSN 后怎么处理":

| 模式 | root? | WG? | 每连接状态机 | 典型场景 |
|------|:-----:|:---:|:-----------:|---------|
| `tun` | ✓ | ✓ | 0(本地)/ 1(远程) | 物理服务器 |
| `userspace`(默认) | ✗ | ✓ | 2(smoltcp + proxy) | 无特权容器 |
| `wss` | ✗ | ✗ | 1(proxy) | 只能 TCP:443 的网络 |

详见 [data-flow.md](./data-flow.md)。

### TUN vs UserSpace 的真实差异

容易误解: "TUN 更快,UserSpace 是兼容性兜底"。**不对**。

UserSpace 每连接经历 **2 个 TCP 状态机**:

```
gotatun decrypt → smoltcp (TCP #1) → 字节流 → proxy.connect() → 内核 (TCP #2) → target
```

TUN 模式让**内核原生处理 TCP**:

```
TUN(本地服务):  gotatun decrypt → ACL → TUN → kernel → service   [0 个额外状态机]
TUN(远程服务):  gotatun decrypt → ACL → TUN → kernel → VIP proxy → target  [1 个]
```

差异不是在性能(万兆以下几乎无差别),而是**状态管理**:
- 消除在 smoltcp 上复刻完整 TCP 行为(拥塞控制、快速重传、TSO/GRO)的需求。
- 对本地内核协议栈的优化(零拷贝、TCP offload)"免费"享用。

选 UserSpace 是因为它不需要特权,不是因为它更简单。

## 控制面: SSE / Noise / QUIC

### 三种传输的对比

| 模式 | 外层传输 | 对 DPI 暴露 | 适用场景 |
|-----|---------|------------|---------|
| `sse`(默认) | TLS/HTTPS | SNI + 证书 CN 可见 | 普通网络、调试、CDN 友好 |
| `noise` | Noise-IK over TCP | 随机字节流,无 SNI/TLS 指纹 | 被深包检测的受限网络 |
| `quic` | QUIC over UDP | 通用 UDP 流量,无 SNI | 需低延迟、HTTPS 可能被干扰的环境 |

### 架构: 共享内层,可插拔外壳

[控制面架构: 共享内层 · 可插拔外壳](./diagrams/control-transport-trait.d2)

> 更详细的版本(含 EventSigVerifier / merge.rs / NSD 内部组件)见 [`diagrams/control-plane.d2`](./diagrams/control-plane.d2)。

**关键点**: 内层协议永远是 SSE(HTTP/1.1 `text/event-stream`)。只是**外壳**不同。这意味着:
- 事件解析代码**一份**(`crates/control/src/sse.rs`)。
- 添加新外壳只需要实现 `ControlTransport` trait(`crates/control/src/transport/mod.rs`)。
- NSD 侧三个监听器落在**同一个 HTTP 后端**,状态完全共享。

### 为什么 Noise?

- `sse` 暴露 SNI 和证书 Common Name —— DPI 设备可以从握手阶段就识别 "NSIO 控制面流量"。
- Noise-IK 在 TCP 上直接跑,**没有 TLS 握手、没有 SNI、没有证书链**。流量在 wire 上看起来就是**随机字节**。
- Noise-IK 复用 `machinekey`(X25519) —— 不需要额外分发密钥。
- 选择 `snow` 0.9 实现,DPDK / eBPF 友好。

### 为什么 QUIC?

- QUIC 是现代 UDP 协议,被越来越多网络友好对待(HTTP/3 普及的副作用)。
- 没有 SNI —— QUIC 1-RTT 握手本身不暴露服务名(可选 ALPN 才会暴露)。
- 复用 `machinekey`,通过 `rustls` 的 "raw public keys"(RFC 7250)验证,**不需要 CA**。
- 支持 0-RTT 重连,RTT 敏感场景(比如移动 NSC)更友好。
- 选择 `quinn` 0.11 实现。

### 部署选择建议

```
普通网络 / 调试:
  --control-mode=sse --data-plane=userspace  (WG 自动,回退 WSS)

受限网络 (只放 HTTPS):
  --control-mode=sse --data-plane=wss

DPI 检测 SNI:
  --control-mode=noise --data-plane=wss
  (控制面无指纹,数据面用 WSS 走 443)

DPI 检测全部 HTTPS:
  --control-mode=quic --data-plane=wss
  (控制面用 UDP,数据面 WSS 伪装成 HTTPS)
```

## 直连与 P2P (未来设计)

两种**尚未实现**的路径保留在设计层:

### 直连 (NSC ↔ NSN)

当 NSD 判断 NSC 和 NSN 可以直接互达(双方都有公网 IP 或都在 NAT 后且支持打洞):

```
NSD 下发给 NSC:
  gateway_config: { gateways: [...] }         # 正常 NSGW 路径
  direct_peers: [                              # 直连 (未实现)
    { id: "nsn-office", endpoint: "5.6.7.8:51820", pubkey: "..." }
  ]
```

NSC 会先尝试 `direct_peers`,不可达再回退 NSGW。**当前代码没有 `direct_peers` 事件,也没有直连 peer 的代码路径** —— 这是保留设计。

### WebRTC DataChannel

通过 STUN/TURN 做 NAT 穿透,然后在 SCTP over DTLS 上跑业务流:

```
1. NSC 和 NSN 通过 NSD 交换 SDP offer (信令)
2. ICE 候选收集 (STUN)
3. NAT 穿透尝试
4. 成功 → P2P DataChannel (UDP, SCTP 可靠传输)
5. 失败 → 通过 NSGW 的 TURN 中继
```

限制:
- WebRTC 仅支持 UDP;严格封锁 UDP 的网络仍需要 WSS 回退。
- 比原生 WG 更重(SCTP + DTLS + ICE 开销)。
- 浏览器版 NSC 可以原生使用 WebRTC —— 这是未来做浏览器客户端时的主要路径。

**当前代码没有 WebRTC / STUN / TURN / SCTP / DTLS 路径,也没有 SDP 信令**。保留供后续实现。

## 关键设计决策速查

| 决策 | 选择 | 理由 |
|------|------|------|
| 控制面分离 | SSE 永远作为内层 | 保证事件解析代码单一 |
| 控制面可插拔 | `ControlTransport` trait | 替换外壳不改业务逻辑 |
| 复用 machinekey | Noise 和 QUIC 都用 X25519 | 不分发额外密钥,简化密钥管理 |
| 数据面两协议 | WG + WSS,自动回退 | UDP 快但可能封;TCP:443 永远通 |
| 两跳独立选路 | NSC-GW 和 GW-NSN 各自选 | 两端网络环境无关 |
| 代理即 NAT | 不改包头,只做 `proxy.connect` | 本地/远程服务逻辑同构 |
| 按服务选隧道 | `services.toml` 支持 `tunnel=wg/ws/auto` | 特定服务强制协议(如 SSH 必须走 WG) |
| 按服务选网关 | `services.toml` 支持 `gateway=...` | "SSH 必须走审计网关"等需求 |

## 无 smoltcp 的 ACL (TUN 模式前提)

TUN 模式下 ACL 只需要 IP 头五元组,**不需要完整 TCP 状态机**:

```rust
// 概念等价
fn parse_five_tuple(packet: &[u8]) -> Option<FiveTuple> {
    let src_ip  = &packet[12..16];
    let dst_ip  = &packet[16..20];
    let proto   = packet[9];
    let ihl     = (packet[0] & 0x0f) as usize * 4;
    let src_port = u16::from_be_bytes([packet[ihl], packet[ihl+1]]);
    let dst_port = u16::from_be_bytes([packet[ihl+2], packet[ihl+3]]);
    // ...
}
```

ACL 引擎(`crates/acl/src/engine.rs`)不关心数据来源 —— 同一套规则既能用于 TUN 的 `HybridNatSend`,也能用于 UserSpace 的 `ServiceRouter::resolve`。

## NAT 简化: "代理即 NAT"

**传统 NAT**: 每个包都要改写目的 IP 头、重算校验和、维护 connection tracking。

**NSIO NAT**: 连接级别,不改写包头。流程:

```rust
// 伪代码,对应 crates/nat/src/router.rs 思路
async fn handle_connection(service: &ServiceDef) {
    let target = resolve(&service.host, service.port).await;
    let upstream = TcpStream::connect(target).await;
    proxy_relay(inbound, upstream).await;
}
```

本地服务和远程服务逻辑**完全相同**,只是 `target` 地址不同:
- 本地服务: `127.0.0.1:22`
- 远程服务: `192.168.1.10:5432` 或 `*.example.com`

这让 NSN 的 NAT 层只需要两件事: **服务查找**(端口 → target) + **TCP/UDP 转发**(`proxy.connect` + `relay`)。

> TUN 模式下的"本地服务直通"是一个例外 —— 它走 `PacketNat` 的 DNAT(改写目的地址写回 TUN),让内核 TCP/IP 栈直接交付。这只适用于"目标就是 NSN 所在主机"的场景。

## 协议栈速览

```
NSC                    NSGW                   NSN
───                    ────                   ───

Application            Bridge                 Application
  ↕                      ↕                      ↕
Local Access           Protocol               Service Router
(TUN/VIP/DNS)          Translation            (ACL + proxy)
  ↕                      ↕                      ↕
WG or WSS            WG ←→ WSS              WG or WSS
  ↕                      ↕                      ↕
gotatun / WsFrame    kernel WG             gotatun / WsFrame
                     + Bun relay
  ↕                      ↕                      ↕
UDP / TCP:443        UDP / TCP:443          UDP / TCP:443
```

## 核心不变量 (给实现者)

- **控制面事件解析只存在一份**: 不要在 Noise 或 QUIC 模块里重新实现 SSE 解析。
- **`ControlTransport` 只负责**"打开一条双向字节管道": 传给 SSE 解析器的必须是 raw HTTP/1.1 字节流。
- **WG 和 WSS 不共享会话状态**: 每个网关每个协议独立维护,防止状态污染。
- **`services.toml` 的 `tunnel=wg` 在 `wss` 模式下是 hard fail**: 不做隐式降级,让用户知道配置与运行模式不匹配。
- **不要在控制面里放业务数据**: SSE 事件只承载配置,不要夹带流量。
- **`MultiControlPlane` 聚合多个 NSD 时,ACL 取并集并标注来源 NSD**;**运行时放行再与本地 `services.toml` ACL 取交集**。安全不变量在本地 ACL 层,而不是"多 NSD 都同意才放行"——self-host + cloud 共存场景下后者会让规则凭空消失,是反运维直觉的 bug。
- **所有 NSD → NSN / NSC 的配置事件必须带 Ed25519 签名**,验签用注册响应里的 `server_signing_key_pub`。即使 SSE/Noise/QUIC 任一传输被中间人降级(企业 TLS 反代 / CA 注入 / pin 配置遗漏),篡改事件也无法通过签名校验——两层都被攻破才能影响配置。

## 参考文件

| 主题 | 源文件 |
|------|-------|
| 多网关选路 | `crates/connector/src/multi.rs` |
| WG 隧道 + UAPI | `crates/tunnel-wg/src/lib.rs` |
| WSS 隧道 + WsFrame | `crates/tunnel-ws/src/lib.rs` |
| ControlTransport trait | `crates/control/src/transport/mod.rs` |
| SSE / Noise / QUIC 外壳 | `crates/control/src/transport/{sse,noise,quic}.rs` |
| 多 NSD 合并 | `crates/control/src/multi.rs` / `crates/control/src/merge.rs` |
| 认证 (machinekey/peerkey) | `crates/control/src/auth.rs` |
| 设备流 | `crates/control/src/device_flow.rs` |
| MachineState 密钥对 | `crates/common/src/state.rs` |
