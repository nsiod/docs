# NSGW · 远景与演进

> 本页是 [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 中**与 NSGW 相关**的生产化能力汇总。
>
> 核心问题:**"如果 NSIO 要把 NSGW 做到生产级(tailscale DERP / cloudflare WARP / headscale 网关同档次),需要补齐哪些能力?"** 本页给出六大能力轴、40+ 项功能预测,以及 traefik 去留的两条路线。

## 1. 架构再审视 · traefik 是否继续

当前 mock 与 gerbil 都用 **traefik v3** 作为 L7 入口,但随着 NSGW 职责扩展到 **L4 端口映射**(无 NSC 用户直接 `ssh nsgw:2222`)和 **多 PoP 协同策略**,traefik 定位开始受挑战:

- **定位错位**: traefik 擅长"一个集群内部的南北向 HTTP 网关",但 NSGW 首要身份是**跨协议数据面中继**(WG/WSS/QUIC → NSN)
- **L4 短板**: traefik 的 TCP / SNI 路由可用但不是主打
- **控制面重复**: traefik 有自己的 providers / middlewares / transports DSL,NSD SSE 事件要翻译两次(SSE → 动态配置文件 → traefik 内部状态)
- **运维双栈**: NSGW 本体 + traefik 两进程、两套日志、两份升级节奏

### 路线 A · 自研轻量 Proxy + 外部入口层

NSGW **只做数据面**:WG peer 管理 + WSS/QUIC 帧中继 + 基本 HTTP/HTTPS 转发 + L4 端口映射;从 NSD 消费 4 类 SSE 事件(`wg_config` / `routing_config` / `gateway_http_config` / `gateway_l4_map`)。全链路策略(OIDC / WAF / 全局限速 / 证书签发)交给**外部入口层**(Cloudflare / AWS ALB / 前置 traefik 或 envoy)。

```
Browser ──→ [外部入口:CF / envoy / traefik]  ──→ NSGW ──WG/WSS──→ NSN
              (OIDC/WAF/全局策略)                  (TLS 终结 +
                                                  轻量路由 +
                                                  L4 端口映射)
SSH client ───────────────────────────────────────→ NSGW :2222
                                                  (L4 转发到 NSN:22)
```

- **收益**: 代码库小、无 traefik 依赖、L4/L7 同进程、SSE 是唯一控制接口
- **代价**: 中间件需部署方额外引入一层
- **适用**: 自建型 / 延迟敏感 / 希望 NSGW 是无状态简单代理

### 路线 B · Envoy + WG + 外部控制中心

用 **Envoy** 替代 traefik,整合进 NSGW:Envoy 天然同时支持 **L4** 与 **L7**,而且有成熟的 xDS 控制平面接口。NSD 新增"NSGW 控制 bridge",把 SSE 事件翻译成 xDS(LDS/RDS/CDS/EDS)推送给 Envoy;WG peer 同步仍走内核 WG。

```
Browser / SSH / any TCP ──→ NSGW[ Envoy + WG ]  ──→ NSN
                            ↑
                     xDS (LDS/RDS/CDS/EDS)
                            ↑
                     NSD 控制 bridge (SSE → xDS)
```

- **收益**: L4/L7 统一、WAF/ext_authz 生态齐全;xDS 业界标准;未来 mTLS/SPIFFE 零成本
- **代价**: Envoy 体量大;NSD 需实现 xDS 适配层;运维门槛高
- **适用**: 多 PoP SaaS / 丰富 L7 策略 / NSGW 作为真·流量入口

### 当前倾向

**路线 A 先行,保留向 B 演进的路径**:

1. 先落地"让用户能用"比"花哨中间件"优先级更高
2. 外部入口层可复用用户既有的 Cloudflare / ALB 投资
3. 保持 SSE 作为唯一控制通道,避免过早引入 xDS 复杂度
4. 未来切到 Envoy 时,NSD 的 `gateway_http_config` / `gateway_l4_map` 事件结构保持不变 —— 只是下游消费者换掉,站点侧无感

详见 → [11 · nsgw-vision §架构再审视](../11-nsd-nsgw-vision/nsgw-vision.md#架构再审视--是否需要-traefik)

## 2. 轴 ① 连接能力 (Transport)

**主问题**: **"NSC / NSN 用什么协议 + 什么端口接入 NSGW"**。多协议并存的目的是在不同网络环境下保证可达。

### G1 子能力清单

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G1.1 | WireGuard UDP 终结 | ✅ mock + gerbil | ✅ | ✅ | ✅ | [G1.1](../11-nsd-nsgw-vision/nsgw-vision.md#g11-wireguard-udp-终结) |
| G1.2 | WSS Relay(WsFrame) | ✅ mock `wss-relay.ts` | ✅ | ✅ | ✅ | [G1.2](../11-nsd-nsgw-vision/nsgw-vision.md#g12-wss-relay-wsframe-协议) |
| G1.3 | QUIC 数据面 | ❌ | | ✅ | ✅ | [G1.3](../11-nsd-nsgw-vision/nsgw-vision.md#g13-quic-数据面) |
| G1.4 | Noise 数据面 | ❌ | | | ✅ | [G1.4](../11-nsd-nsgw-vision/nsgw-vision.md#g14-noise-数据面) |
| G1.5 | MASQUE / HTTP/3 CONNECT-UDP | ❌ | | | ✅ | [G1.5](../11-nsd-nsgw-vision/nsgw-vision.md#g15-masque--http3-connect-udp) |
| G1.6 | UDP Hole Punch Coordinator | ✅ gerbil `relay/relay.go:27-33` | | ✅ | ✅ | [G1.6](../11-nsd-nsgw-vision/nsgw-vision.md#g16-udp-hole-punch-coordinator) |
| G1.7 | 内置 STUN | ❌ | | ✅ | ✅ | [G1.7](../11-nsd-nsgw-vision/nsgw-vision.md#g17-内置-stun) |
| G1.8 | 内置 TURN 兜底 | ❌ | | | ✅ | [G1.8](../11-nsd-nsgw-vision/nsgw-vision.md#g18-内置-turn-兜底) |
| G1.9 | PROXY Protocol v1 | ✅ gerbil `main.go:134-223` | ✅ | ✅ | ✅ | [G1.9](../11-nsd-nsgw-vision/nsgw-vision.md#g19-proxy-protocol-v1) |
| G1.10 | PROXY Protocol v2 | ❌ | | ✅ | ✅ | [G1.10](../11-nsd-nsgw-vision/nsgw-vision.md#g110-proxy-protocol-v2) |
| G1.11 | mTLS 终结 | ❌ | | ✅ | ✅ | [G1.11](../11-nsd-nsgw-vision/nsgw-vision.md#g111-mtls-终结) |
| G1.12 | SO_REUSEPORT / 多进程 | ❌ | | | ✅ | [G1.12](../11-nsd-nsgw-vision/nsgw-vision.md#g112-so_reuseport--多进程负载) |
| G1.13 | Gateway-to-Gateway Mesh | ❌ | | | ✅ | [G1.13](../11-nsd-nsgw-vision/nsgw-vision.md#g113-gateway-to-gateway-mesh) |

## 3. 轴 ② 路由与寻址 (Routing)

**主问题**: **"进来的流量怎么知道送到哪个 NSN 或哪个后端服务"**。

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G2.1 | WG Peer 动态同步 | ✅ mock `subscribeToNsdSse` | ✅ | ✅ | ✅ | [G2.1](../11-nsd-nsgw-vision/nsgw-vision.md#g21-wg-peer-动态同步) |
| G2.2 | HTTP/HTTPS 动态路由 | ✅ mock `handleRoutingConfig` | ✅ 基础 | ✅ + 中间件 | ✅ | [G2.2](../11-nsd-nsgw-vision/nsgw-vision.md#g22-httphttps-动态路由-traefik-是早期选择) |
| G2.3 | SNI / L4 端口映射 | ✅ gerbil `SNIProxy` | ✅ 基础 | ✅ + PROXY v2 + GeoIP | ✅ | [G2.3](../11-nsd-nsgw-vision/nsgw-vision.md#g23-sni--l4-端口映射) |
| G2.4 | Anycast IP | ❌ | | | ✅ | [G2.4](../11-nsd-nsgw-vision/nsgw-vision.md#g24-anycast-ip) |
| G2.5 | GeoDNS | ❌ | | ✅ | ✅ | [G2.5](../11-nsd-nsgw-vision/nsgw-vision.md#g25-geodns) |
| G2.6 | 跨网关热迁移 | ❌ | | | ✅ | [G2.6](../11-nsd-nsgw-vision/nsgw-vision.md#g26-跨网关热迁移) |
| G2.7 | 路由优先级 + 回落 | ❌ | | ✅ | ✅ | [G2.7](../11-nsd-nsgw-vision/nsgw-vision.md#g27-路由优先级--回落) |
| G2.8 | Path-based routing | 参考 Pangolin | | ✅ | ✅ | [G2.8](../11-nsd-nsgw-vision/nsgw-vision.md#g28-path-based-routing) |
| G2.9 | Header-based routing | 参考 Pangolin | | ✅ | ✅ | [G2.9](../11-nsd-nsgw-vision/nsgw-vision.md#g29-header-based-routing) |
| G2.10 | A/B 测试路由 | ❌ | | | ✅ | [G2.10](../11-nsd-nsgw-vision/nsgw-vision.md#g210-ab-测试路由) |
| G2.11 | Virtual Port 路由 | ✅ mock `routing_config` | ✅ | ✅ | ✅ | [G2.11](../11-nsd-nsgw-vision/nsgw-vision.md#g211-virtual-port-路由) |

### G2.3 的重点扩展 —— L4 端口映射

L4 路径不解 TLS,但必须具备**连接级中间件**(与端口映射同通道下发):

- IP allow/deny CIDR 列表(握手前过滤)
- GeoIP 规则
- 每源 IP 的新建连接速率限制(抗 SSH 暴力破解)
- 并发连接数上限(per IP / per map)
- fail2ban 式自动封禁
- 连接配额(每租户每日)
- 审计日志(源 IP / 时长 / 字节 / 关闭原因)
- PROXY Protocol v2(透传真实客户端身份)

**SSE 事件**: 新增 `gateway_l4_map` 下发 `{listen_port, proto, target_nsn, target_port, acl_ref, allow_cidr, deny_cidr, geo_rules, conn_limits, audit_sink}`。

## 4. 轴 ③ 安全能力 (Security)

**主问题**: **"不怀好意的流量怎么挡住,合法流量怎么降速"**。

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G3.1 | 基础限速 | ❌ | | ✅ | ✅ | [G3.1](../11-nsd-nsgw-vision/nsgw-vision.md#g31-基础限速) |
| G3.2 | UDP flood 防御 | ❌ | | ✅ | ✅ | [G3.2](../11-nsd-nsgw-vision/nsgw-vision.md#g32-udp-flood-防御) |
| G3.3 | IP 信誉 / CrowdSec | ❌ (Pangolin 有雏形) | | ✅ | ✅ | [G3.3](../11-nsd-nsgw-vision/nsgw-vision.md#g33-ip-信誉--crowdsec) |
| G3.4 | WAF(基础) | ❌ | | ✅ | ✅ | [G3.4](../11-nsd-nsgw-vision/nsgw-vision.md#g34-waf-基础) |
| G3.5 | WAF(企业规则集) | ❌ | | | ✅ | [G3.5](../11-nsd-nsgw-vision/nsgw-vision.md#g35-waf-企业规则集) |
| G3.6 | Bot 管理 | ❌ | | | ✅ | [G3.6](../11-nsd-nsgw-vision/nsgw-vision.md#g36-bot-管理) |
| G3.7 | 零信任策略点(ZT Proxy) | ❌ | | | ✅ | [G3.7](../11-nsd-nsgw-vision/nsgw-vision.md#g37-零信任策略点-zt-proxy) |
| G3.8 | Resource 级认证 | ❌ (Pangolin 有) | | ✅ | ✅ | [G3.8](../11-nsd-nsgw-vision/nsgw-vision.md#g38-resource-级认证) |
| G3.9 | DDoS L3/L4 | ❌ | | | ✅(上游) | [G3.9](../11-nsd-nsgw-vision/nsgw-vision.md#g39-ddos-l3l4) |
| G3.10 | DDoS L7 | ❌ | | | ✅ | [G3.10](../11-nsd-nsgw-vision/nsgw-vision.md#g310-ddos-l7) |
| G3.11 | Trusted Upstream | ✅ gerbil `trustedUpstreams` | | ✅ | ✅ | [G3.11](../11-nsd-nsgw-vision/nsgw-vision.md#g311-trusted-upstream) |
| G3.12 | Slow loris 防护 | ❌ | | ✅ | ✅ | [G3.12](../11-nsd-nsgw-vision/nsgw-vision.md#g312-slow-loris-防护) |

## 5. 轴 ④ 容灾与高可用 (Resilience)

**主问题**: **"网关挂了 / 升级 / 配置错误能快速回滚"**。

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G4.1 | 健康检查端点 | ✅ mock `/ready` + gerbil `/healthz` | ✅ + 分段汇报 | ✅ | ✅ | [G4.1](../11-nsd-nsgw-vision/nsgw-vision.md#g41-健康检查端点) |
| G4.2 | Graceful Shutdown | ✅ gerbil `server.Shutdown` | ✅ | ✅ | ✅ | [G4.2](../11-nsd-nsgw-vision/nsgw-vision.md#g42-graceful-shutdown) |
| G4.3 | 热升级(drain + swap) | ❌ | | ✅ | ✅ | [G4.3](../11-nsd-nsgw-vision/nsgw-vision.md#g43-热升级-drain--swap) |
| G4.4 | 蓝绿部署 | ❌ | | ✅ | ✅ | [G4.4](../11-nsd-nsgw-vision/nsgw-vision.md#g44-蓝绿部署) |
| G4.5 | 金丝雀 | ❌ | | | ✅ | [G4.5](../11-nsd-nsgw-vision/nsgw-vision.md#g45-金丝雀) |
| G4.6 | 跨区 Failover | ❌ | | | ✅ | [G4.6](../11-nsd-nsgw-vision/nsgw-vision.md#g46-跨区-failover) |
| G4.7 | 会话状态快照 | ❌ | | | ✅ | [G4.7](../11-nsd-nsgw-vision/nsgw-vision.md#g47-会话状态快照) |
| G4.8 | 自愈(auto-restart) | ❌ | ✅ | ✅ | ✅ | [G4.8](../11-nsd-nsgw-vision/nsgw-vision.md#g48-自愈-auto-restart) |
| G4.9 | 配置回滚 | ❌ | | ✅ | ✅ | [G4.9](../11-nsd-nsgw-vision/nsgw-vision.md#g49-配置回滚) |

## 6. 轴 ⑤ 可观测性 (Telemetry)

**主问题**: **"每个连接发生了什么,聚合起来看系统整体状况"**。

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G5.1 | Prometheus metrics | ❌ | ✅ | ✅ | ✅ | [G5.1](../11-nsd-nsgw-vision/nsgw-vision.md#g51-prometheus-metrics) |
| G5.2 | pprof | ✅ gerbil 裸挂 | ✅ + token + loopback | ✅ | ✅ | [G5.2](../11-nsd-nsgw-vision/nsgw-vision.md#g52-pprof) |
| G5.3 | OpenTelemetry traces | ❌ | | ✅ | ✅ | [G5.3](../11-nsd-nsgw-vision/nsgw-vision.md#g53-opentelemetry-traces) |
| G5.4 | 结构化访问日志 | ❌ | | ✅ | ✅ | [G5.4](../11-nsd-nsgw-vision/nsgw-vision.md#g54-结构化访问日志) |
| G5.5 | 连接级日志(WG) | ❌ | | ✅ | ✅ | [G5.5](../11-nsd-nsgw-vision/nsgw-vision.md#g55-连接级日志-wg) |
| G5.6 | 带宽上报 | ✅ gerbil `periodicBandwidthCheck` | ✅ | ✅ | ✅ | [G5.6](../11-nsd-nsgw-vision/nsgw-vision.md#g56-带宽上报) |
| G5.7 | 实时拓扑上报 | ❌ | | ✅ | ✅ | [G5.7](../11-nsd-nsgw-vision/nsgw-vision.md#g57-实时拓扑上报) |
| G5.8 | 采样率控制 | ❌ | | | ✅ | [G5.8](../11-nsd-nsgw-vision/nsgw-vision.md#g58-采样率控制) |
| G5.9 | 内存 watchdog | ✅ gerbil `monitorMemory(512MB)` | ✅ | ✅ | ✅ | [G5.9](../11-nsd-nsgw-vision/nsgw-vision.md#g59-内存-watchdog) |

## 7. 轴 ⑥ 资源管理 (Resource)

**主问题**: **"一个 NSGW 能承载多少,避免少数用户抢占,按用量计费"**。

| ID | 功能 | 现状 | MVP | GA | 企业级 | 原文 |
| --- | --- | --- | --- | --- | --- | --- |
| G6.1 | 每 peer 带宽计量 | ✅ gerbil 雏形 | | ✅ | ✅ | [G6.1](../11-nsd-nsgw-vision/nsgw-vision.md#g61-每-peer-带宽计量) |
| G6.2 | 每 org 配额 | ❌ | | ✅ | ✅ | [G6.2](../11-nsd-nsgw-vision/nsgw-vision.md#g62-每-org-配额) |
| G6.3 | QoS 分类(prod/dev/bulk) | ❌ | | | ✅ | [G6.3](../11-nsd-nsgw-vision/nsgw-vision.md#g63-qos-分类-prod--dev--bulk) |
| G6.4 | Linux tc 整形 | ❌ | | | ✅ | [G6.4](../11-nsd-nsgw-vision/nsgw-vision.md#g64-linux-tc-整形) |
| G6.5 | eBPF 整形 | ❌ | | | ✅(可选) | [G6.5](../11-nsd-nsgw-vision/nsgw-vision.md#g65-ebpf-整形) |
| G6.6 | 计费埋点 | ❌ | | ✅ | ✅ | [G6.6](../11-nsd-nsgw-vision/nsgw-vision.md#g66-计费埋点) |
| G6.7 | WSS 背压 | ❌ | | ✅ | ✅ | [G6.7](../11-nsd-nsgw-vision/nsgw-vision.md#g67-wss-背压) |
| G6.8 | 连接数上限(per IP / user) | ❌ | | ✅ | ✅ | [G6.8](../11-nsd-nsgw-vision/nsgw-vision.md#g68-连接数上限-per-ip--per-user) |
| G6.9 | 过载降级 | ❌ | | | ✅ | [G6.9](../11-nsd-nsgw-vision/nsgw-vision.md#g69-过载降级) |
| G6.10 | cgroup / k8s limits | 部署层 | ✅ | ✅ | ✅ | [G6.10](../11-nsd-nsgw-vision/nsgw-vision.md#g610-cgroup--k8s-limits) |

## 8. 与 NSD 的协作矩阵(待设计契约)

NSGW 许多生产能力需要 NSD 配套新增契约(详见 [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md)):

| NSGW 能力 | 需要 NSD 配合什么 | 状态 |
| --------- | ----------------- | ---- |
| WG peer 动态同步 | SSE `wg_config` | ✅ 已有 |
| HTTP/HTTPS 动态路由 | SSE `routing_config` / `gateway_http_config` | ✅ 基础已有 · 扩展字段待设计 |
| L4 端口映射(SSH 等) | 新 SSE `gateway_l4_map` | ❌ 待设计 |
| mTLS 终结 | NSD 下发 CA bundle | ❌ 待设计 |
| 零信任策略点 | NSD 提供 `POST /api/v1/authz` | ❌ 待设计 |
| 每 org 配额 | NSD 下发配额配置 | ❌ 待设计 |
| 计费埋点 | NSD 提供 `POST /api/v1/billing/ingest` | ❌ 待设计 |
| 跨网关热迁移 | NSD 协调 session 转移 | ❌ 待设计 |
| 拓扑上报 | NSD 加 `POST /api/v1/gateway/topology` | ❌ 待设计 |
| CA bundle 更新 | 新 SSE `ca_bundle_update` | ❌ 待设计 |

## 9. 数据面协议扩展 · NSGW 视角

来自 [11 · data-plane-extensions](../11-nsd-nsgw-vision/data-plane-extensions.md):

| 能力 | NSGW 改造 | 落地级别 | 原文 |
| ---- | --------- | -------- | ---- |
| **D1 · P2P 直连(NAT 穿透)** | 做 signaling coordinator;流量不经过自己(除 hole punch 失败) | GA / 企业级 | [D1](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d1-p2p-直连-nat-穿透) |
| **D2 · 多路径(MPTCP / WG+WSS 并行)** | 支持 NSN 的多连接并行;packet scheduler 匹配 | GA / 企业级 | [D2](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d2-多路径-mptcp--wgwss-并行) |
| **D3 · BBR/CUBIC 拥塞控制** | WSS 模式下 per-socket setsockopt | GA | [D3](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d3-拥塞控制-bbr--cubic-可选) |
| **D4 · FEC 前向纠错** | 新 `Fec` 帧类型传递 | 企业级 | [D4](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d4-前向纠错-fec) |
| **D5 · Edge NSN** | 支持 edge NSN 的低频心跳与缓冲 | 企业级 | [D5](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d5-边缘计算结合-nsn-at-the-edge) |
| **D6 · 移动 / IoT 优化** | 动态 keepalive 参数;会话 ID 续连 | GA / 企业级 | [D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d6-iot--移动端优化) |
| **D7 · 跨云统一数据面** | Private Link 对接;多云 NSGW 互联 | 企业级 | [D7](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d7-跨云统一控制面--数据面) |
| **D9 · BYO-CA** | 验证客户自带 CA 签的 client cert | 企业级 | [D9](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d9-客户自带-ca-byo-ca) |
| **D10 · 硬件加速** | SmartNIC / DPU offload WG;eBPF 路由 | 企业级 | [D10](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d10-硬件加速) |

## 10. 功能数量自检

| 轴 | 子能力数 |
| -- | -------- |
| ① 连接 | 13 |
| ② 路由 | 11 |
| ③ 安全 | 12 |
| ④ 容灾 | 9 |
| ⑤ 观测 | 9 |
| ⑥ 资源 | 10 |
| **合计** | **64 项** |

## 11. 关键设计决策 (Open)

1. **语言选型** —— Go (续 gerbil) vs Rust (统一 NSN) vs Bun (保留 mock)?当前倾向 **Go 做核心数据面,Bun 可做控制面 agent**
2. **单进程 vs 多进程** —— WG kernel + traefik + WSS relay + SNI proxy 是否合进一个进程?参考 gerbil 是单进程
3. **内置 TURN vs 外部 TURN** —— MVP 外部(借 WSS relay);GA 评估内置 coturn-equivalent

详见 → [11 · nsgw-capability-model §关键设计决策](../11-nsd-nsgw-vision/nsgw-capability-model.md#关键设计决策-open)

## 12. 不在路线图内(明确放弃 / 延后)

| 事项 | 理由 |
| ---- | ---- |
| NSGW 内置完整的 IdP / Authn | 那是 NSD 职责 |
| NSGW 维护应用层状态(session cookie 等) | 只做字节中继 / TLS 终结 |
| NSGW 合并多 NSD 配置 | 一个 NSGW 只跟一个集群的 NSD 对话;多 NSD 合并在 NSN |
| NSGW 自己分配虚拟 IP | IP 管理在 NSD;NSGW 只做 peer 表 |
| 去掉 WG 改纯 TCP/WSS | WG 是**最低延迟路径**,必须保留 |

---

更详细的能力建模与分级落地见原章节:

- [11 · index](../11-nsd-nsgw-vision/index.md) · 愿景陈述与读者导航
- [11 · methodology](../11-nsd-nsgw-vision/methodology.md) · 能力建模、功能分级
- [11 · nsgw-capability-model](../11-nsd-nsgw-vision/nsgw-capability-model.md) · NSGW 六大能力轴详解
- [11 · nsgw-vision](../11-nsd-nsgw-vision/nsgw-vision.md) · 40+ 功能 × 价值/挑战/落地级别
- [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md) · 跨组件控制面新契约
- [11 · data-plane-extensions](../11-nsd-nsgw-vision/data-plane-extensions.md) · 跨组件数据面新能力
- [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) · 60+ 功能 × 7 列对比
- [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md) · 生产部署形态 + SLA
- [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) · MVP → GA → 企业级
