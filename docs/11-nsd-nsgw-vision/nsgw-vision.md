# NSGW 功能预测 · 生产化愿景

> **读者**: NSGW owner / 数据面架构师。
>
> **目标**: 在 [nsgw-capability-model.md](./nsgw-capability-model.md) 的六条能力轴下,逐项给出具体功能预测。格式与 [nsd-vision.md](./nsd-vision.md) 一致 —— **价值 / 用户故事 / 技术挑战 / 架构影响 / 落地级别**。

40+ 项功能。

---

## 架构再审视 · 是否需要 traefik?

当前 mock (`tests/docker/nsgw-mock/`) 和早期生产参考 (`tmp/gateway/`) 都把 **traefik v3** 作为 NSGW 的 L7 入口 —— 文件 provider watch + 动态路由/中间件/证书管理一整套。这套方案在"公网 HTTPS 发布"这个使用场景下够用,但随着 NSGW 的职责扩展到 **L4 端口映射**(无 NSC 用户直接 `ssh nsgw:2222` 转发到 NSN)和 **多 PoP 协同策略**,traefik 的定位开始受挑战:

- **定位错位**: traefik 擅长 "一个集群内部的南北向 HTTP 网关",但 NSGW 首要身份是**跨协议数据面中继**(WG/WSS/QUIC → NSN),HTTPS 入站只是其中一条路径。
- **L4 短板**: traefik 的 TCP / SNI 路由可用但不是主打;SSH / 任意 TCP 端口映射需要更轻的 L4 代理原语。
- **控制面重复**: traefik 有自己的 providers / middlewares / transports DSL,NSD SSE 事件必须被翻译两次(SSE → traefik 动态配置文件 → traefik 内部状态)。
- **运维双栈**: NSGW 本体(Go/Rust) + traefik(Go) 两个进程、两套日志、两份升级节奏 —— 对一个 "流量入口单点" 不友好。

因此需要在 GA 前对"NSGW 的形态"做一次决断。下面列两条候选路线,后续 G 系列功能(路由/安全/容灾)的落地以最终选定的路线为准。

### 路线 A · 自研轻量 Proxy + 外部入口层

NSGW **只做数据面**:WG peer 管理 + WSS/QUIC 帧中继 + **基本 HTTP/HTTPS 转发** + **L4 端口映射**;从 NSD 消费 `wg_config` / `routing_config` / `gateway_http_config` / `gateway_l4_map` 四类 SSE 事件即可。全链路策略(OIDC / WAF / 全局限速 / 证书签发)交给**外部入口层** —— 可以是 Cloudflare / AWS ALB / 任意 ingress,也可以是一台前置的 traefik 或 envoy,但**不属于 NSGW 的代码边界**。

```
Browser ──→ [外部入口:CF / envoy / traefik]  ──→ NSGW ──WG/WSS──→ NSN
              (OIDC/WAF/全局策略)                  (TLS 终结 +
                                                  轻量路由 +
                                                  L4 端口映射)
SSH client ───────────────────────────────────────→ NSGW :2222
                                                  (L4 转发到 NSN:22)
```

- **收益**: NSGW 代码库小、无 traefik 依赖、L4/L7 同一个进程内处理、SSE 事件是唯一控制接口。
- **代价**: 中间件(OIDC / WAF 等)需要部署方额外引入一层,不能"开箱即用"。
- **适用**: 自建型用户 / 对延迟敏感 / 希望 NSGW 是无状态简单代理的场景。

### 路线 B · Envoy + WG + 外部控制中心

用 **Envoy** 替代 traefik,整合进 NSGW:Envoy 天然同时支持 **L4 (TCP/UDP/SSH)** 与 **L7 (HTTP/HTTPS/gRPC)**,而且有成熟的 xDS 控制平面接口。NSD 侧新增一个 "NSGW 控制 bridge",把 SSE 事件翻译成 xDS (LDS/RDS/CDS/EDS) 推送给 Envoy;WG peer 同步仍走内核 WG。

```
Browser / SSH / any TCP ──→ NSGW[ Envoy + WG ]  ──→ NSN
                            ↑
                     xDS (LDS/RDS/CDS/EDS)
                            ↑
                     NSD 控制 bridge (SSE → xDS)
```

- **收益**: L4/L7 统一、WAF / ext_authz / 高级中间件生态齐全(Istio / Contour 同源);xDS 是业界标准,多 PoP 同步成熟;未来做 mTLS / SPIFFE 几乎零成本。
- **代价**: Envoy 体量大、内存占用比轻量代理高一档;NSD 需要实现 xDS 适配层;Envoy 运维经验门槛高于 traefik。
- **适用**: 多 PoP SaaS / 需要丰富 L7 策略 / 把 NSGW 作为真·流量入口的场景。

### 对比

| 维度 | A · 自研轻 Proxy | B · Envoy + WG |
|------|------------------|----------------|
| L4 端口映射(SSH 等) | ✅ 原生 | ✅ 原生(Envoy TCP listener) |
| L7 中间件(OIDC/WAF) | ❌ 交外部入口层 | ✅ 内建 + ext_authz |
| 代码体量 | 小(Go/Rust 单进程) | 大(Envoy + 控制 bridge) |
| 控制接口 | SSE(已有) | xDS(需要 NSD 适配) |
| 多 PoP 一致性 | SSE 广播足矣 | xDS 增量同步 |
| 运维门槛 | 低 | 中到高 |
| 未来 mTLS / SPIFFE | 需要补实现 | 开箱即用 |
| 可否逐步演进到 B | ✅ 可 | — |

### 本章节功能的归属

- **G1.1 / G1.2 / G1.6 / G1.9 ~ G1.13(WG / WSS / 打洞 / PROXY / mTLS / 多核 / mesh)**:两条路线都需要,归属 NSGW 本体,以下章节按"与路线无关"的方式描述。
- **G2.2(动态路由) / G2.3(SNI) / G3.4 ~ G3.10(WAF / 策略点)**:
  - 路线 A:NSGW 内只保留 **基础路由 + L4 map**,WAF/OIDC 等标注为"外部入口层责任"。
  - 路线 B:以上全部由 **Envoy + 控制 bridge** 提供,xDS 化。
- 本章后续段落用 "*traefik 是早期选择*" 标记所有与 traefik 强耦合的条目,待路线决策后重写。

### 当前倾向

倾向 **路线 A 先行,保留向路线 B 演进的路径**: NSGW 先做成轻量 Proxy(WG + WSS + 基本 HTTP 转发 + L4 端口映射 + SSE 策略消费),把"全局策略面"明确划在 NSGW 之外;当产品成长到需要把 WAF / OIDC / 多 PoP xDS 这些能力"内化"时,再引入 Envoy。理由:

1. 先落地"让用户能用"比先落地"花哨中间件"优先级更高。
2. 外部入口层可以复用用户既有的 Cloudflare / ALB 投资,不强加 NSGW 专属栈。
3. 保持 SSE 作为唯一控制通道,避免过早引入 xDS 的复杂度。
4. 未来切换到 Envoy 时,NSD 的 `gateway_http_config` / `gateway_l4_map` 事件结构保持不变 —— 只是下游消费者从"NSGW 自研代理"换成"NSGW 控制 bridge → Envoy xDS",站点侧无感。

---

## ① 连接 · 功能清单

### G1.1 WireGuard UDP 终结

- **现状**: ✅ mock `wg-setup.ts`(通过 shell `wg` 命令) + 生产 `tmp/gateway/main.go:327-329` (via `wgctrl-go`)。
- **目标**: 合并为生产 Go 实现,接入 NSIO SSE 契约。
- **技术挑战**: SSE 事件格式 (`wg_config`) 已定义(`tests/docker/nsgw-mock/src/index.ts:189-194`),生产 NSGW 要消费同样的 JSON。
- **落地级别**: MVP。

### G1.2 WSS Relay (WsFrame 协议)

- **现状**: ✅ mock 已完整实现 `wss-relay.ts:1-675`,包括"连接器↔客户端"缝合。
- **目标**: 生产级实现,迁到 Go/Rust;背压 + 多路复用。
- **技术挑战**: `probeOpenOnConnector` (mock `index.ts:130-144`) 这种"测试 NSN 是否接受 open" 的能力要泛化成健康探测。
- **落地级别**: MVP。

### G1.3 QUIC 数据面

- **现状**: NSD mock 侧有 `quic-listener.ts`(控制面用),NSGW 侧**数据面无 QUIC**。
- **价值**: QUIC 自带 loss recovery + 0-RTT,在移动网络下比 WSS 好;同时是 HTTP/3 的基础。
- **技术挑战**: 把 WsFrame 协议映射到 QUIC streams;选择 Go quic-go / Rust quinn 库。
- **落地级别**: GA。

### G1.4 Noise 数据面

- **现状**: NSD mock 有 `noise-listener.ts`(控制面用),NSGW 侧无。
- **价值**: 在 DPI 严苛环境下作为 WSS / QUIC 的替代。
- **落地级别**: 企业级。

### G1.5 MASQUE / HTTP/3 CONNECT-UDP

- **价值**: 通过 CDN 穿透严格防火墙,HTTPS 对外看起来是普通 HTTP/3 流量。
- **落地级别**: 企业级。

### G1.6 UDP Hole Punch Coordinator

- **现状**: ✅ 生产 gerbil 有 `HolePunchMessage` (`tmp/gateway/relay/relay.go:27-33`), `EncryptedHolePunchMessage`。
- **价值**: 两个 NSN / NSC 直连打洞,NSGW 只做 signaling,流量不经过自己。
- **落地级别**: GA。

### G1.7 内置 STUN

- **价值**: 客户端知道自己的公网映射 (用于 hole punch)。
- **落地级别**: GA。

### G1.8 内置 TURN 兜底

- **价值**: 打洞失败时中继。
- **技术挑战**: 引入 coturn-equivalent Go/Rust 实现;或利用现有 WSS relay 作为 TURN-like fallback。
- **落地级别**: 企业级。

### G1.9 PROXY Protocol v1

- **现状**: ✅ 生产 gerbil 已支持 (`tmp/gateway/main.go:134-223`,`proxyProtocol` flag,默认 `true`)。
- **落地级别**: MVP。

### G1.10 PROXY Protocol v2

- **价值**: v2 是二进制版,效率更高,支持 TLV 扩展(如携带 client cert 指纹)。
- **落地级别**: GA。

### G1.11 mTLS 终结

- **价值**: 特定域名强制客户端出示证书。
- **技术挑战**(*traefik 是早期选择*): traefik v3 支持 `clientCerts`,需要在 NSD 侧下发 CA bundle。**路线 A** 下需要自研 TLS 终结器读取 NSD 下发的 CA bundle;**路线 B** 下 Envoy 原生支持 `validation_context`,由 NSD 的 xDS bridge 下发即可。
- **落地级别**: GA。

### G1.12 SO_REUSEPORT / 多进程负载

- **价值**: 单机多核并发处理 WG UDP,提高吞吐。
- **落地级别**: 企业级。

### G1.13 Gateway-to-Gateway Mesh

- **价值**: 多 NSGW 之间组 mesh,同 org 流量在 mesh 内转发。
- **落地级别**: 企业级。

---

## ② 路由 · 功能清单

### G2.1 WG Peer 动态同步

- **现状**: ✅ mock `subscribeToNsdSse` + 对比 `sseTrackedPeers` 增删 peer (`tests/docker/nsgw-mock/src/index.ts:201-292`)。
- **落地级别**: MVP。

### G2.2 HTTP/HTTPS 动态路由 (*traefik 是早期选择*)

- **现状**: ✅ mock `handleRoutingConfig` 写文件 (`tests/docker/nsgw-mock/src/traefik-config.ts`);traefik 文件 provider watch。
- **扩展**: 路由 + 中间件链(rate-limit, auth, headers, retries)。
- **落地形态**:
  - **路线 A**: NSGW 内置轻量 HTTP 反向代理(Go 的 `httputil.ReverseProxy` / Rust 的 `pingora` 级别),中间件链交给外部入口层。
  - **路线 B**: Envoy HCM (HttpConnectionManager) + RDS 动态路由 + filter chain(OIDC / WAF / rate-limit 通过 Envoy 原生 filter)。
- **落地级别**: MVP (基础路由),GA (中间件)。

### G2.3 SNI / L4 端口映射

- **现状**: ✅ 生产 `tmp/gateway/proxy/proxy.go:43-60` `SNIProxy`,含本地 SNI 白名单 `localSNIs`。
- **扩展**: 泛化为**任意 L4 端口映射** —— 无 NSC 用户直接连 `nsgw-host:2222` 转发到 `nsn-site:22` 上的 SSH;同理支持 psql / redis / 任意 TCP/UDP。
- **L4 连接级中间件**(必备,与端口映射同通道下发): L4 路径不解 TLS,因此做不了 L7 的 OIDC / WAF,但必须具备**连接级治理**:
  - IP allow/deny CIDR 列表(握手前过滤)
  - GeoIP 规则(按国家/区域放行)
  - 每源 IP 的新建连接速率限制(抗 SSH 暴力破解)
  - 并发连接数上限(per IP / per map)
  - fail2ban 式自动封禁(握手失败率阈值触发)
  - 连接配额(每租户每日连接数上限)
  - 审计日志(源 IP / 时长 / 字节数 / 关闭原因)
  - PROXY Protocol v2(把真实客户端身份透传给后端 NSN 上的服务)
- **SSE 事件**: NSD 通过新的 `gateway_l4_map` SSE 事件下发 `{listen_port, proto, target_nsn, target_port, acl_ref, allow_cidr, deny_cidr, geo_rules, conn_limits, audit_sink}`;一张事件包含"映射 + 中间件"完整策略,NSGW 在 listener 层原子应用。
- **落地形态**:
  - **路线 A**: 自研 L4 转发器(`SO_REUSEPORT` + per-port goroutine / tokio task),SNI 嗅探直接用 `smoltcp` 或手写解析器;中间件用 Go/Rust 内置的 CIDR trie + 令牌桶即可。
  - **路线 B**: Envoy TCP listener + `tcp_proxy` filter + SNI filter + `network.filters.rbac` + `network.filters.local_rate_limit`,xDS LDS 推送 listener 配置。
- **落地级别**: MVP (SNI + 基础 L4 + IP 白名单 + 连接限速),GA (完整中间件链 + PROXY v2 + GeoIP)。

### G2.4 Anycast IP

- **价值**: 多地区 NSGW 共用一个 IP,BGP 自动就近。
- **技术挑战**: 需要自治系统 (AS) + BGP peering,或用 Cloudflare / AWS Global Accelerator 代做。
- **落地级别**: 企业级。

### G2.5 GeoDNS

- **价值**: 不用 Anycast 也能做地理就近。
- **落地级别**: GA。

### G2.6 跨网关热迁移

- **价值**: 用户从 US-East 挪到 EU-West(差旅),现有 TCP 连接不断。
- **技术挑战**: 需要 session 迁移 + 新 gateway 知道老会话状态。
- **落地级别**: 企业级。

### G2.7 路由优先级 + 回落

- **价值**: 主 NSN 健康时去主,不健康回落到备。
- **技术挑战**: traefik 有 `weighted` strategy,但"健康感知"需要自定义 healthcheck。
- **落地级别**: GA。

### G2.8 Path-based routing

- **价值**: `/api/*` 路由到一个 NSN,`/admin/*` 路由到另一个。
- **参考**: `tmp/control/src/components/PathMatchRenameModal.tsx`, `resource-target-address-item.tsx`。
- **落地级别**: GA。

### G2.9 Header-based routing

- **参考**: `tmp/control/src/components/HeadersInput.tsx`, `SetResourceHeaderAuthForm.tsx`。
- **落地级别**: GA。

### G2.10 A/B 测试路由

- **价值**: 按比例分流到 canary NSN。
- **落地级别**: 企业级。

### G2.11 Virtual Port 路由

- **现状**: ✅ mock `routing_config` 事件有 `virtual_port` 字段 (`tests/docker/nsgw-mock/src/index.ts:237-239`),traefik 把流量转发到 `nsn_wg_ip:virtual_port`。
- **落地级别**: MVP。

---

## ③ 安全 · 功能清单

### G3.1 基础限速

- **价值**: 防止滥用。
- **落地级别**: GA。

### G3.2 UDP flood 防御

- **价值**: WG handshake 是 UDP,易被 amplify 攻击。
- **落地级别**: GA。

### G3.3 IP 信誉 / CrowdSec

- **参考**: `tmp/control/install/crowdsec.go` 已有初步集成。
- **价值**: 借助社区情报挡恶意 IP。
- **落地级别**: GA。

### G3.4 WAF (基础)

- **价值**: 识别 SQL 注入 / XSS / 恶意 UA。
- **技术挑战**(*traefik 是早期选择*):
  - **路线 A**: 不在 NSGW 内置 WAF,由**外部入口层**(Cloudflare / AWS WAF / 前置 Envoy)承担;NSGW 只上报命中事件。
  - **路线 B**: Envoy + Coraza WASM filter(或 `ext_authz` 到独立 WAF 服务),规则集通过 xDS 下发。
- **落地级别**: GA。

### G3.5 WAF (企业规则集)

- **价值**: OWASP CRS + 定制规则集。
- **落地级别**: 企业级。

### G3.6 Bot 管理

- **价值**: 挡爬虫 / 扫描器。
- **落地级别**: 企业级。

### G3.7 零信任策略点 (ZT Proxy)

- **价值**: 流量到达 NSGW 后,先问 NSD"这个用户能不能访问这个 resource",再决定放行。
- **参考**: `tmp/control/src/components/OrgPolicyRequired.tsx`, `OrgPolicyResult.tsx`, `ResourceAuthPortal.tsx`, `ResourceAccessDenied.tsx`。
- **落地级别**: 企业级。

### G3.8 Resource 级认证

- **参考**: `tmp/control/src/app/[orgId]/settings/resources/proxy/[niceId]/authentication/page.tsx`, `SetResourcePasswordForm.tsx`, `SetResourcePincodeForm.tsx`。
- **价值**: 某个 resource 访问时要输密码 / PIN / email 验证。
- **落地级别**: GA。

### G3.9 DDoS L3/L4

- **落地级别**: 企业级 (依赖上游)。

### G3.10 DDoS L7

- **价值**: challenge (JS / captcha) 识别机器人。
- **落地级别**: 企业级。

### G3.11 Trusted Upstream

- **现状**: ✅ gerbil 已支持 `trustedUpstreams` (`tmp/gateway/main.go:216`)。
- **价值**: 只有受信任上游能发 PROXY 协议头。
- **落地级别**: GA。

### G3.12 Slow loris 防护

- **价值**: 挡"慢连接攻击"。
- **落地级别**: GA。

---

## ④ 容灾 · 功能清单

### G4.1 健康检查端点

- **现状**: ✅ mock `/ready` + 生产 `/healthz`。
- **扩展**: 分段汇报 (WG / WSS / traefik / SSE 订阅分别状态)。
- **落地级别**: MVP。

### G4.2 Graceful Shutdown

- **现状**: ✅ gerbil `main.go:404-424` 有 `server.Shutdown(shutdownCtx)` 5 秒超时。
- **扩展**: drain 阶段拒新连接继续服务老连接,直到超时。
- **落地级别**: MVP。

### G4.3 热升级 (drain + swap)

- **价值**: 升级无中断。
- **技术挑战**: WG 内核接口的接管 —— 新进程接管同一个 `wg0`。
- **落地级别**: GA。

### G4.4 蓝绿部署

- **价值**: 两套完整栈并行,DNS/Anycast 切换瞬间。
- **落地级别**: GA。

### G4.5 金丝雀

- **价值**: 按比例分流到新版本。
- **落地级别**: 企业级。

### G4.6 跨区 Failover

- **价值**: 单区不可用时整体失败转移。
- **依赖**: Anycast 或 GeoDNS。
- **落地级别**: 企业级。

### G4.7 会话状态快照

- **价值**: WSS `activeSessions` 定期持久化,重启后恢复。
- **落地级别**: 企业级。

### G4.8 自愈 (auto-restart)

- **价值**: 进程崩溃自动重启 (systemd / k8s liveness)。
- **落地级别**: MVP。

### G4.9 配置回滚

- **价值**: traefik 配置写坏了能 rollback。
- **落地级别**: GA。

---

## ⑤ 观测 · 功能清单

### G5.1 Prometheus metrics

- **价值**: 标准指标: connections, bytes_in/out, handshake_success/fail, p99_latency。
- **落地级别**: MVP。

### G5.2 pprof

- **现状**: ✅ gerbil `tmp/gateway/main.go` 直接 `_ "net/http/pprof"` (裸挂)。
- **扩展**: 加 token 保护 + 默认只绑 127.0.0.1。
- **落地级别**: MVP。

### G5.3 OpenTelemetry traces

- **价值**: 每请求 trace_id,和 NSD / NSN 关联。
- **落地级别**: GA。

### G5.4 结构化访问日志

- **价值**: traefik access log JSON 化,送 SIEM。
- **落地级别**: GA。

### G5.5 连接级日志 (WG)

- **价值**: handshake / keepalive / error 事件。
- **落地级别**: GA。

### G5.6 带宽上报

- **现状**: ✅ gerbil `periodicBandwidthCheck` (`tmp/gateway/main.go:345-348`)。
- **扩展**: 改为推 Prometheus + 支持 OTel metrics。
- **落地级别**: MVP。

### G5.7 实时拓扑上报

- **价值**: 上报活跃 peer 到 NSD,NSD 聚合成拓扑图。
- **落地级别**: GA。

### G5.8 采样率控制

- **价值**: 高 QPS 下采样,避免淹没 telemetry。
- **落地级别**: 企业级。

### G5.9 内存 watchdog

- **现状**: ✅ gerbil `monitorMemory(512MB)` (`tmp/gateway/main.go:119`)。
- **落地级别**: MVP。

---

## ⑥ 资源管理 · 功能清单

### G6.1 每 peer 带宽计量

- **价值**: 精确统计每 WG peer 的 bytes_in/out。
- **现状**: ✅ gerbil `relay/relay.go` / `main.go` 已有计量雏形。
- **落地级别**: GA。

### G6.2 每 org 配额

- **价值**: org 超配额自动降速。
- **依赖**: NSD 下发 org 配额。
- **落地级别**: GA。

### G6.3 QoS 分类 (prod / dev / bulk)

- **价值**: 关键业务优先。
- **落地级别**: 企业级。

### G6.4 Linux tc 整形

- **价值**: 精确带宽控制。
- **落地级别**: 企业级。

### G6.5 eBPF 整形

- **价值**: tc 的现代替代。
- **落地级别**: 企业级 (可选)。

### G6.6 计费埋点

- **价值**: bytes / duration / connection 上报到 NSD billing (见 [nsd-vision.md](./nsd-vision.md) F5.13)。
- **落地级别**: GA。

### G6.7 WSS 背压

- **价值**: 慢消费者时向源反压,避免 OOM。
- **落地级别**: GA。

### G6.8 连接数上限 (per IP / per user)

- **价值**: 防止一个 user 吃光所有 socket。
- **落地级别**: GA。

### G6.9 过载降级

- **价值**: 系统过载时优先保证付费 tier。
- **落地级别**: 企业级。

### G6.10 cgroup / k8s limits

- **落地级别**: MVP (部署层)。

---

## 生产化 NSGW 架构全景

以下图示以**路线 A**(自研轻 Proxy + 外部入口层)的形态呈现;路线 B 的差异仅是把 `HTTP_FWD` / `L4_MAP` / 中间件节点替换成 **Envoy + xDS**,外围数据面结构一致。

[NSGW 生产化架构全景 (路线 A)](./diagrams/nsgw-production-architecture.d2)

完整版本见 [diagrams/nsgw-vision-arch.d2](./diagrams/nsgw-vision-arch.d2)。

## 功能数量自检

- 连接: 13
- 路由: 11
- 安全: 12
- 容灾: 9
- 观测: 9
- 资源管理: 10

**合计 64 项 NSGW 功能**。

## 与 NSD 的协作矩阵

| NSGW 能力 | 需要 NSD 配合什么 |
|-----------|------------------|
| WG peer 动态同步 | SSE `wg_config` 事件 (✅ 已有) |
| HTTP/HTTPS 动态路由 | SSE `routing_config` / `gateway_http_config` 事件 (✅ 基础已有 · 扩展字段待设计) |
| L4 端口映射 (SSH 等) | 新 SSE `gateway_l4_map` 事件 (❌ 待设计) |
| mTLS 终结 | NSD 下发 CA bundle (❌ 待设计) |
| 零信任策略点 | NSD 提供 `POST /api/v1/authz` 查询接口 (❌ 待设计) |
| 每 org 配额 | NSD 下发配额配置 (❌ 待设计) |
| 计费埋点 | NSD 提供 `POST /api/v1/billing/ingest` 端点 (❌ 待设计) |
| 跨网关热迁移 | NSD 协调 session 转移 (❌ 待设计) |
| 拓扑上报 | NSD 加 `POST /api/v1/gateway/topology` 端点 (❌ 待设计) |
| CA bundle 更新 | 新 SSE 事件 `ca_bundle_update` (❌ 待设计) |

上述 "❌ 待设计" 事项详见 [control-plane-extensions.md](./control-plane-extensions.md)。

下一章 → [control-plane-extensions.md](./control-plane-extensions.md)
