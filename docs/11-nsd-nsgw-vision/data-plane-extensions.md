# 数据面扩展能力

> **读者**: 数据面架构师 / 性能工程师 / 网络工程师。
>
> **目标**: 列出那些**跨越 NSGW / NSN / NSC 三方**的数据面能力 —— P2P 直连、多路径、BBR、FEC、边缘与移动端优化、跨云。这些能力不属于任何单一组件,必须三方协商实现。

## 当前数据面形态 (baseline)

### 两种数据面:TUN 模式 vs UserSpace 模式

详见 [../03-data-plane/index.md](../03-data-plane/index.md)。简述:

- **WG 模式**: `crates/tunnel-wg/` via `gotatun`,用户态 WireGuard,不需要 root
- **WSS 模式**: `crates/tunnel-ws/` 的 WsFrame 二进制协议,UDP 被阻断时的 fallback
- **选路**: `crates/connector/src/multi_gateway_manager.rs` 按 latency 探测 + 权重选择

### 当前限制

1. **一次只能走一条 gateway** —— `MultiGatewayManager` 选一个 primary,其他备用;不做 multi-path 并行
2. **无 NAT 穿透** —— 所有流量必走 NSGW;没有 P2P 直连
3. **没有 BBR** —— WG 走 UDP 不需要,但 WSS 走 TCP,默认走系统 CUBIC
4. **没有 FEC** —— 对丢包敏感的应用(VoIP / 视频)没有额外保护
5. **没有 MPTCP** —— 移动端信号切换瞬间全断

生产级数据面要补齐这些。

---

## 能力 D1: P2P 直连 (NAT 穿透)

### 目标场景

两个 NSC/NSN 在同一 NAT 后,或都能被外部到达,流量**直接在两者之间走 WG**,不经过 NSGW。

### 协作流程

[P2P 打洞协作时序](./diagrams/p2p-hole-punch-sequence.d2)

### 现有基础

- 生产 gerbil `tmp/gateway/relay/relay.go:21-33` 有 `HolePunchMessage` / `EncryptedHolePunchMessage` / `ClientEndpoint` 结构
- 生产 gerbil `tmp/gateway/main.go:85-88` 有 `HolePunchMessage` 类型

### 技术挑战

1. **NAT 类型检测** — Cone / Restricted / Symmetric (Symmetric 打洞基本不成)
2. **端口预测** — 对某些路由器要连续发送探测包预测端口
3. **IPv6 Preferred** — 双栈下优先 v6 打洞,避免 NAT
4. **连续心跳** — 连通后维持 NAT 映射

### 落地级别

- MVP: 无
- GA: 基础 hole punch (Cone NAT 成功)
- 企业级: 完整 ICE-like (多候选地址 + 多路径探测)

### 对 NSIO 独立主张的影响

P2P 直连是**性能优化**,不改变"NSGW 是必经之路"的语义。即使 P2P 成功,ACL 仍在 NSN 侧执行,控制面仍通过 NSD。这点与 ZeroTier 的 P2P 模式一致。

---

## 能力 D2: 多路径 (MPTCP / WG+WSS 并行)

### 目标场景

客户端同时通过 WG 和 WSS 连两个不同的 NSGW(或同一 NSGW 的两个端口),流量同时走两条路径,互为冗余 + 聚合带宽。

### 两种实现

**实现 A: MPTCP**
- 只适用于 WSS 模式
- 要求操作系统内核支持 (Linux 5.6+, macOS 部分)
- 本质上是 "同一个 TCP 连接用多个子流"
- 优点: 应用层无感;切子流时上层 TCP 不断

**实现 B: WG+WSS 并行**
- NSIO 原生,由 `MultiGatewayManager` 管理
- 两个独立隧道同时活跃,Packet 在连接层做选择
- 挑战: 乱序包需要重排序缓冲区

### 技术挑战

1. **子流健康度** — 每条子流独立 RTT / loss 监测
2. **Packet scheduler** — Min-RTT / Round-robin / Redundant 多种策略
3. **调度开销** — 增加 per-packet 决策时间

### 落地级别

- GA: WG+WSS 双活(不聚合,只用于 failover)
- 企业级: 真正多路径(带宽聚合 + packet-level scheduling)

---

## 能力 D3: 拥塞控制 (BBR / CUBIC 可选)

### 场景

WSS 模式走 TCP,NSN / NSGW 之间可能跨高延迟高丢包链路。Linux 内核默认 CUBIC,对 bufferbloat 不友好。

### 方案

- **BBR v2** — Google 提出,在高 BDP 场景下吞吐优于 CUBIC
- **可运行时切换** — NSN/NSGW 启动参数选择 tcp_congestion_control
- **per-socket setsockopt** — 不改全局内核参数

### 技术挑战

1. **WG UDP 走不到 TCP CC** — 只对 WSS 有效
2. **gotatun userspace** — WG 用户态实现自己不做 CC,依赖上层;本身就是 UDP 所以不适用

### 落地级别

- GA: 配置项可选 (BBR / CUBIC / Reno)
- 企业级: 自动选择 (根据链路特征)

---

## 能力 D4: 前向纠错 (FEC)

### 场景

VoIP / 视频流对丢包敏感,重传会引入抖动。FEC 通过冗余包预防丢包。

### 方案

- **Reed-Solomon** — 经典方案,开销 ~10~30%
- **WebRTC-style** — NACK + RTX + FEC 混合
- **在 WsFrame 里加 FEC type** — 新帧类型 `WsFrame::Fec { group_id, k, n, ... }`

### 落地级别

- 企业级。

---

## 能力 D5: 边缘计算结合 (NSN at the edge)

### 场景

NSN 跑在 edge node (CDN PoP / IoT gateway / 企业分支),流量先在 edge 终结,再经 NSGW 进入 backbone。

### 架构

[Edge NSN 架构](./diagrams/edge-nsn-architecture.d2)

### 关键特性

1. **Edge NSN 需要无头部署** — 通过 provisioning key (见 nsd-vision F3.10) 自动注册
2. **Edge 缓存** — 静态资源在 edge 缓存 (Varnish / nginx)
3. **Edge 计算** — 简单策略 (limit, redirect) 在 edge 执行

### 落地级别

- 企业级。

---

## 能力 D6: IoT / 移动端优化

### 挑战

- 电量敏感 — heartbeat 频率不能高
- 信号波动 — 需要断线续连不中断应用
- 设备多样 — Android / iOS / RTOS

### 特定能力

| 能力 | 说明 |
|------|------|
| 低功耗心跳 | `keepalive_interval` 按网络类型动态调整 (WiFi 25s / 4G 60s) |
| 断点续连 | 会话 ID 持久化,重连不重新握手 |
| 网络切换感知 | 从 WiFi 切 4G 不断开 (依赖 MPTCP 或应用层重建) |
| 移动 SDK (iOS/Android) | NetworkExtension (iOS) / VpnService (Android) 集成 |
| Wakelock 优化 | push notifications 而不是长轮询 |

### 落地级别

- GA (基础)
- 企业级 (全栈)

### 与 NSIO 独立主张的配合

NSIO 的**127.11.x.x VIP + 本地 DNS**模型非常适合移动端 — 不需要 TUN 权限,Android 可运行在普通 App 沙箱里 (借助 SOCKS / HTTP CONNECT);iOS 可作为普通 App 而非 VPN Extension。这是**重要的差异化**,移动端对权限要求越低越好。

---

## 能力 D7: 跨云统一控制面 + 数据面

### 场景

企业同时在 AWS / GCP / Azure 有基础设施,希望**一套 NSIO 管起来**。

### 架构

- NSD 部署在 AWS (primary)
- NSGW 部署在三个云的各 region (总共 6-9 个)
- NSN 跑在各云的 VPC 内
- GeoDNS 让用户按地理 / 云归属选择 NSGW

### 关键特性

| 能力 | 说明 |
|------|------|
| 云原生健康检查 | 对接 AWS Route53 / GCP Cloud Load Balancing / Azure Traffic Manager |
| Private Link 对接 | AWS PrivateLink / GCP PSC / Azure Private Endpoint |
| 云账单对齐 | NSGW 按云 region 打标签,计费与云账单对齐 |
| 跨云密钥托管 | AWS KMS / GCP Cloud KMS / Azure Key Vault 三选一 |
| 跨云日志 | CloudWatch / Stackdriver / Log Analytics 对接 |

### 落地级别

- 企业级。

---

## 能力 D8: 私有 DNS 与企业 AD 集成

### 场景

企业有自己的 `.corp` 域名和 AD DNS。希望 NSC 访问 `app.corp` 时:
1. 优先解析到 NSIO 内部 (`.n.ns`)
2. 没有时 fallback 到企业 AD DNS
3. 最后才公网 DNS

### 方案

- NSC 本地 DNS resolver (现有) 可配置 split DNS
- `.n.ns` 和 `.d.ns`(文档中已定义)保留给 NSIO
- 企业域名单独配置 upstream

### 落地级别

- GA。

---

## 能力 D9: 客户自带 CA (BYO-CA)

### 场景

大企业已有 PKI 基础设施,不希望 NSIO 重新发证。

### 方案

- Web UI / CLI 上传 CA 根证书
- machinekey 改为 X.509 证书 (而不是裸 Ed25519)
- NSN/NSGW 验证链

### 落地级别

- 企业级。

---

## 能力 D10: 硬件加速

### 场景

大流量 NSGW (10Gbps+) CPU 瓶颈在加解密。

### 方案

- **AES-NI** — x86 自带,默认开启 (gotatun 已使用)
- **SMART NIC / DPU** — 数据面 offload 到 NIC
- **eBPF** — 内核级路由 / NAT / 整形

### 落地级别

- 企业级。

---

## 数据面扩展总览

[数据面扩展能力总览](./diagrams/data-plane-extensions-overview.d2)

---

## 对 NSIO 独立主张的影响汇总

| 能力 | 独立主张影响 |
|------|------------|
| P2P 直连 | 保持"NSGW 是控制器,不一定是流量路径"思想 |
| 多路径 | `MultiGatewayManager` 已有底子,扩展为并行 |
| BBR | 不影响 |
| FEC | 不影响 |
| 边缘计算 | 强化 "NSN 可以无处不在" |
| IoT/移动 | **127.11.x.x VIP + 无 TUN** 是天然优势,要强调 |
| 跨云 | 和"多 NSD 并行"(C8)呼应 — 一个 NSN 可以接多个云的 NSD |
| BYO-CA | 与"Machine PKI"(F1.1)协同 |
| 硬件加速 | 不影响 |

## 下一步

- 看全貌的横向对比 → [feature-matrix.md](./feature-matrix.md)
- 落地顺序 → [roadmap.md](./roadmap.md)
- 运维形态 → [operational-model.md](./operational-model.md)
