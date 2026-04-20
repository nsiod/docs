# NSGW · 已知缺陷与改进项

> 本页汇总 NSGW **当前形态的缺陷与改进项**。来源包括:
>
> - [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 中与 NSGW 协议 / 对端耦合相关的条目(因 NSGW 本身不在本仓库,10 章以 NSN/NSC 视角写)
> - [`docs/11-nsd-nsgw-vision/nsgw-capability-model.md §当前坐标`](../11-nsd-nsgw-vision/nsgw-capability-model.md#当前坐标-baseline) 中指出的 mock / 生产参考空白
> - [`docs/09-nsgw-gateway/`](../09-nsgw-gateway/index.md) 文中标记的"mock 已知小缺陷"
>
> 字段约定:**P0** = 安全 / 可用性危及生产;**P1** = 严重影响功能或运维;**P2/P3** = 待优化。
>
> 审查依据:HEAD 2026-04-20。

## 1. P0 / P1 必修

| ID | 一句话 | 位置 | 原文 |
| --- | --- | --- | --- |
| [ARCH-004 · FUNC-007](#arch-004--func-007--multigatewaymanager-健康检查未真正定时执行) | `MultiGatewayManager::health_interval` dead_code,Failed gateway 不退避重连(NSN 侧,NSGW 协议面) | `crates/connector/src/multi.rs:156-157` | [ARCH-004](../10-nsn-nsc-critique/architecture-issues.md#arch-004--multigatewaymanager-健康检查周期被-allowdead_code-遮蔽) · [FUNC-007](../10-nsn-nsc-critique/functional-gaps.md#func-007--nsgw-健康检查未真正定时执行指-connector-端) |
| [ARCH-009](#arch-009--wss-单条-tcp-耦合-多-nsgw-无法并行) | 单 WSS = 单 TCP,多 NSGW 只冗余不并行;HOL blocking | `crates/tunnel-ws/src/lib.rs:279-300` · `crates/connector/src/lib.rs:200-228` | [ARCH-009](../10-nsn-nsc-critique/architecture-issues.md#arch-009--connector-选路策略与-tunnel-ws-流路由耦合于-wss-单条-tcp-连接) |
| [SEC-013](#sec-013--wss-open-帧无客户端身份断言-已决议-subject-重构) | WSS Open 无 NSC 身份,本地 vs WSS 路径 ACL 不对称 `[RESOLVED in spec]` | `crates/tunnel-ws/src/lib.rs:480-498` | [SEC-013](../10-nsn-nsc-critique/security-concerns.md#sec-013) · 规范 [03 · tunnel-ws §2.4](../03-data-plane/tunnel-ws.md#24-open-帧的-source-identity-扩展) |
| [SEC-015](#sec-015--wss-open-target_ip-未校验) | NSGW 侧 WSS Open 帧的 `target_ip` 未校验,可绕过 NSN 之外的目标过滤 | `crates/tunnel-ws/src/lib.rs:480-498` | [SEC-015](../10-nsn-nsc-critique/security-concerns.md#sec-015) |
| [OPS-001](#ops-001--tests-dockernsgw-mock-与-生产-gerbil-未融合) | mock 有 SSE 但无生产能力;gerbil 有生产能力但不消费 NSIO SSE | `tests/docker/nsgw-mock/` · `tmp/gateway/` | [11 · nsgw-capability-model §当前坐标](../11-nsd-nsgw-vision/nsgw-capability-model.md#当前坐标-baseline) |
| [OPS-002](#ops-002--adminshutdown-无访问保护) | `/admin/shutdown` 无 auth,能被任意内网访问者停服 | `tests/docker/nsgw-mock/src/index.ts:74-77` | [09 · deployment §故障排查](../09-nsgw-gateway/deployment.md#故障排查-checklist) |
| [OPS-003](#ops-003--entrypointsh-traefik-不优雅退出) | traefik 后台启动,SIGTERM 时不接信号,连接被硬切 | `tests/docker/nsgw-mock/entrypoint.sh` | [09 · deployment §启动顺序](../09-nsgw-gateway/deployment.md#启动顺序entrypoint-视角) |

## 2. 运营空白(从 mock → 生产的工程差距)

这些是 **mock / gerbil 两套实现都缺的生产能力**——对应 [vision.md §2-7](./vision.md#2-轴--连接能力-transport) 列出但标记 ❌ 的项。按能力轴归类。

### 2.1 连接轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-CONN-001](#gw-conn-001) | 无 QUIC 数据面 | 移动网络 / 0-RTT 场景 fallback 只能走 WSS | GA 时落地(G1.3) |
| [GW-CONN-002](#gw-conn-002) | 无 Noise 数据面 | DPI 严苛环境无替代 | 企业级(G1.4) |
| [GW-CONN-003](#gw-conn-003) | 无内置 STUN / TURN | P2P 打洞成功率没兜底 | GA / 企业级(G1.7/G1.8) |
| [GW-CONN-004](#gw-conn-004) | UDP hole punch 仅 gerbil 有,mock 无 | 直连通路对 mock 部署不可用 | MVP 对齐(G1.6) |
| [GW-CONN-005](#gw-conn-005) | 无 PROXY Protocol v2 | 二进制版 TLV(client cert 指纹)缺失 | GA(G1.10) |
| [GW-CONN-006](#gw-conn-006) | 无 mTLS 终结 | 高安全域名无法强制 client cert | GA(G1.11) |
| [GW-CONN-007](#gw-conn-007) | 无 SO_REUSEPORT / 多进程并发 | 单核瓶颈 | 企业级(G1.12) |

### 2.2 路由轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-ROUTE-001](#gw-route-001) | 无 L4 任意端口映射(SSH/psql 等) | 无 NSC 客户场景受限 | MVP 基础 + GA 中间件(G2.3) |
| [GW-ROUTE-002](#gw-route-002) | 无 GeoDNS / Anycast | 全球用户不能自动就近 | GA(G2.5)/ 企业级(G2.4) |
| [GW-ROUTE-003](#gw-route-003) | 无跨网关热迁移 | 移动用户跨区切 NSGW 要断连 | 企业级(G2.6) |
| [GW-ROUTE-004](#gw-route-004) | 无路由优先级 + 健康感知回落 | 主备切换不智能 | GA(G2.7) |
| [GW-ROUTE-005](#gw-route-005) | 无 path/header-based routing | 不能按 URL 前缀 / HTTP 头路由到不同 NSN | GA(G2.8/G2.9) |
| [GW-ROUTE-006](#gw-route-006) | 无 A/B 分流 | canary 部署无法按比例 | 企业级(G2.10) |

### 2.3 安全轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-SEC-001](#gw-sec-001) | 无基础限速(IP / peer / port) | 易被滥用 | GA(G3.1) |
| [GW-SEC-002](#gw-sec-002) | 无 UDP flood 防御 | WG handshake 可 amplify | GA(G3.2) |
| [GW-SEC-003](#gw-sec-003) | 无 IP 信誉 / CrowdSec | 挡恶意 IP 要靠上游 CDN | GA(G3.3) |
| [GW-SEC-004](#gw-sec-004) | 无 WAF(路线决策挂起) | SQL/XSS 识别缺失 | GA 基础 / 企业级 CRS(G3.4/G3.5) |
| [GW-SEC-005](#gw-sec-005) | 无零信任策略点(Authz Proxy) | 流量到 NSN 才拒,浪费 RTT | 企业级(G3.7) |
| [GW-SEC-006](#gw-sec-006) | 无 Resource 级认证(pwd/pin) | 细粒度访问控制要在应用层做 | GA(G3.8) |
| [GW-SEC-007](#gw-sec-007) | 无 DDoS L7 challenge | 应用层攻击只能 rate-limit | 企业级(G3.10) |
| [GW-SEC-008](#gw-sec-008) | 无 Slow loris 防护 | 慢连接攻击可耗尽 socket | GA(G3.12) |

### 2.4 容灾轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-HA-001](#gw-ha-001) | 无热升级(drain + swap) | 发版必中断 | GA(G4.3) |
| [GW-HA-002](#gw-ha-002) | 无蓝绿部署 | 回滚依赖 DNS/Anycast | GA(G4.4) |
| [GW-HA-003](#gw-ha-003) | 无跨区 failover 自动化 | 区故障要手工介入 | 企业级(G4.6) |
| [GW-HA-004](#gw-ha-004) | 无会话状态快照 | WSS `activeSessions` 重启丢 | 企业级(G4.7) |
| [GW-HA-005](#gw-ha-005) | 无配置回滚机制 | routes.yml 写坏无法 rollback | GA(G4.9) |

### 2.5 观测轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-OBS-001](#gw-obs-001) | 无 Prometheus `/metrics` | 监控对接要手动解析日志 | MVP(G5.1) |
| [GW-OBS-002](#gw-obs-002) | pprof(gerbil)无 auth / 裸挂 | 生产暴露面风险 | MVP + token 保护(G5.2) |
| [GW-OBS-003](#gw-obs-003) | 无 OpenTelemetry traces | 跨组件链路追踪断 | GA(G5.3) |
| [GW-OBS-004](#gw-obs-004) | 无结构化访问日志(JSON) | SIEM 对接要 regex | GA(G5.4) |
| [GW-OBS-005](#gw-obs-005) | 无 WG 连接级日志 | handshake/keepalive/error 看不到 | GA(G5.5) |
| [GW-OBS-006](#gw-obs-006) | 无实时拓扑上报 | NSD 看不到活跃 peer 全貌 | GA(G5.7) |
| [GW-OBS-007](#gw-obs-007) | 无采样率控制 | 高 QPS 下 telemetry 后端被淹 | 企业级(G5.8) |

### 2.6 资源轴

| ID | 缺口 | 影响 | 目标 |
| --- | --- | --- | --- |
| [GW-RES-001](#gw-res-001) | 无每 org 配额 / 限额 | 超量用户无法降速 | GA(G6.2) |
| [GW-RES-002](#gw-res-002) | 无 QoS 分类(prod/dev/bulk) | 关键业务无优先保证 | 企业级(G6.3) |
| [GW-RES-003](#gw-res-003) | 无 tc / eBPF 整形 | 带宽精细控制缺失 | 企业级(G6.4/G6.5) |
| [GW-RES-004](#gw-res-004) | 无计费埋点(bytes/duration/conn → NSD billing) | 商业化基础缺 | GA(G6.6) |
| [GW-RES-005](#gw-res-005) | 无 WSS 背压 | 慢消费者致 OOM 风险 | GA(G6.7) |
| [GW-RES-006](#gw-res-006) | 无连接数上限(per IP / per user) | 单用户吃光 socket | GA(G6.8) |
| [GW-RES-007](#gw-res-007) | 无过载降级(付费 tier 优先) | 过载时不公平 | 企业级(G6.9) |

## 3. 详细条目

### ARCH-004 · FUNC-007 · `MultiGatewayManager` 健康检查未真正定时执行

- **Severity**: P1
- **Location**: `crates/connector/src/multi.rs:156-157` — `#[allow(dead_code)] health_interval: Duration`
- **Current**: 该字段在构造时设为 30 秒,但代码中没有任何 `tokio::time::interval` 由它驱动;健康判定靠"WSS 流自然出错"或"upgrade 探测每 300 秒"被动触发
- **Why a defect**:
  1. 一个 NSGW 在 NSN 视角下 `Connected`,但实际已是僵尸(上次有流量 10 分钟前),选路时仍把它算上
  2. failover 完全靠"下一次请求失败"才发生,**首个用户承担探测代价**
  3. `lowest_latency` 依赖 `gw.latency`,但只在 `mark_connected` 时写入一次,无滚动测量
- **NSGW 侧配套**: 需要 NSGW 暴露稳定的 `/healthz`(已有)+ 对探活包做容量预案(避免 N×M 放大)
- **Fix**: 实现 `health_loop` 周期任务,每 `health_interval` 对 `Connected` gateway 做 2s 轻探(WSS: `/healthz`;UDP: handshake init),更新 latency;连续 N 次失败标 `Failed`,触发 `GatewayEvent::Disconnected`
- 原文 → [ARCH-004](../10-nsn-nsc-critique/architecture-issues.md#arch-004--multigatewaymanager-健康检查周期被-allowdead_code-遮蔽) · [FUNC-007](../10-nsn-nsc-critique/functional-gaps.md#func-007--nsgw-健康检查未真正定时执行指-connector-端)

### ARCH-009 · WSS 单条 TCP 耦合,多 NSGW 无法并行

- **Severity**: P2(NSGW 协议面)
- **Location**: `crates/tunnel-ws/src/lib.rs:279-300` · `crates/connector/src/lib.rs:200-228`
- **Current**: 一个 `ConnectorManager` 同时只能有一个 `Transport::Wss(_)` = 一条 WebSocket 连接;所有 stream 走这条 TCP
- **Why a defect**:
  1. 单连接 HOL blocking:一条流卡或大文件下载降低其他流吞吐
  2. 不能"主用 GW1、次要用 GW2 平衡",只能一个挂了切下一个
  3. 选路策略本质变成"挑首选,其余 standby"
- **NSGW 侧配套**: 要识别"同一 connector 多 TCP 协商"的 v2 frame,并且缝合逻辑支持多 TCP session 并存
- **Fix**: `ConnectorManager` 支持 `Vec<Transport::Wss>`,按 stream-level 选路(同 service 的流 sticky 到同 GW)
- **协调点**: [WS frame v2 spec](../10-nsn-nsc-critique/roadmap.md#5-跨团队协调点),NSGW 需配套升级
- 原文 → [ARCH-009](../10-nsn-nsc-critique/architecture-issues.md#arch-009--connector-选路策略与-tunnel-ws-流路由耦合于-wss-单条-tcp-连接) · [PERF-003](../10-nsn-nsc-critique/performance-concerns.md#perf-003--wss-单-tcp-吞吐瓶颈) · [FAIL-005](../10-nsn-nsc-critique/failure-modes.md#fail-005--wss-单-tcp-连接拥塞)

### SEC-013 · WSS Open 帧无客户端身份断言 `[RESOLVED in spec]`

- **Severity**: P1(已决议规范,NSGW 侧待实现)
- **Location**: `crates/tunnel-ws/src/lib.rs:480-498` · NSGW `/client` 握手
- **Current**(决议前): WSS 路径 ACL 主体来自**客户端自身断言**的 `src`,无 NSGW 身份绑定,本地路径(`src_ip` from WG 解密)和 WSS 路径的 subject 不对称
- **Decision**(2026-04-17): ACL 从 `src: [...]` 重构为 `subject: [...]`(`user:/group:/nsgw:/cidr:`);WSS Open 追加 TLV 扩展携带 `{gateway_id, machine_id}`;缺 TLV fail-closed
- **NSGW 侧动作**:
  1. `/client` 握手后记录 `{gateway_id=self, machine_id from JWT}`
  2. `handleClientFrame()` 转发 Open 帧时追加 TLV 字段
  3. 本机也作为 ACL subject 的一部分参与两级信任的预拒
- **相关**: [05 · ACL §4](../05-proxy-acl/acl.md#4-主体匹配-subject) · [03 · tunnel-ws §2.4](../03-data-plane/tunnel-ws.md#24-open-帧的-source-identity-扩展)
- 原文 → [SEC-013](../10-nsn-nsc-critique/security-concerns.md#sec-013)

### SEC-015 · WSS Open `target_ip` 未校验

- **Severity**: P1
- **Location**: `crates/tunnel-ws/src/lib.rs:480-498`
- **Current**: NSGW 接受的 WSS Open 帧中 `target_ip` 是任意 IP(包括 `127.x.x.x` / `10.x.x.x` / `169.254.x.x`);NSN 端才做终决。NSGW 若不做预拒,攻击者可把 NSGW 当跳板扫描内网
- **Fix**:
  1. NSGW 侧对 `target_ip` 做 bogon / 内网过滤(除非 ACL projection 显式允许)
  2. 与 [09 · responsibilities §⑤](../09-nsgw-gateway/responsibilities.md#-client-ingress-的-acl-预过滤两级信任的前一级) 的预过滤一起落地
- 原文 → [SEC-015](../10-nsn-nsc-critique/security-concerns.md#sec-015)

### OPS-001 · `tests/docker/nsgw-mock` 与生产 gerbil 未融合

- **Severity**: P1(工程形态,不是运行时 bug)
- **Location**: `tests/docker/nsgw-mock/src/` 5 个 TS 文件 · `tmp/gateway/main.go` + `relay/` + `proxy/`
- **Current**:
  - mock 有 **NSD SSE 订阅 + traefik 动态配置**(NSIO 核心契约)但无生产数据面能力
  - gerbil 有 **kernel WG (wgctrl) + SNI 代理 + UDP 中继 + PROXY v1 + 带宽上报 + hole punch** 但**不消费 NSIO SSE**(走 HTTP pull)
- **Impact**: 生产部署只能二选一:"轻量但协议齐全(mock)"或"重量但契约不对齐(gerbil)"。目前两者无合法并集
- **Fix**(路线 A 选型):基于 gerbil Go 代码,把 `/gerbil/get-config` HTTP pull 换成 NSD `/api/v1/config/stream` SSE;保留 SNI proxy + WG kernel + PROXY v1;新增 traefik 动态路由集成(仿 mock `handleRoutingConfig`)
- 原文 → [11 · nsgw-capability-model §当前坐标](../11-nsd-nsgw-vision/nsgw-capability-model.md#当前坐标-baseline) · [11 · roadmap §Phase 1 网关](../11-nsd-nsgw-vision/roadmap.md#网关-nsgw-生产化)

### OPS-002 · `/admin/shutdown` 无访问保护

- **Severity**: P1(测试端点泄漏到生产)
- **Location**: `tests/docker/nsgw-mock/src/index.ts:74-77`
- **Current**: 任何能访问 `9091` 端口的都能 `POST /admin/shutdown` 停掉 NSGW 进程
- **Fix**:
  1. 绑定 `127.0.0.1:9091` 而非 `0.0.0.0`
  2. 或加 Bearer token 校验
  3. 或编译时 `#[cfg(test)]` 条件编译,生产镜像不包含
- 原文 → [09 · deployment §故障排查](../09-nsgw-gateway/deployment.md#故障排查-checklist)

### OPS-003 · `entrypoint.sh` traefik 不优雅退出

- **Severity**: P2
- **Location**: `tests/docker/nsgw-mock/entrypoint.sh`
- **Current**: `traefik --configFile=... &` 后台,`exec bun run src/index.ts` 让 Bun 成为 PID 1;SIGTERM 时 Bun 优雅退出(`src/index.ts:386-387`),但 **traefik 子进程不接信号**
- **Impact**: 升级 / 重启时 traefik 被 SIGKILL,连接被硬切
- **Fix**: 用 `supervisord` 或 `s6-overlay`;或在 Bun 进程退出前 `kill -TERM ${traefik_pid}` 等待

### GW-CONN-001 · 无 QUIC 数据面

- **Severity**: P2
- **Current**: NSD mock 侧有 `quic-listener.ts`(控制面用),NSGW 侧**数据面无 QUIC**
- **Value**: QUIC 自带 loss recovery + 0-RTT,在移动网络比 WSS 好;HTTP/3 基础
- **Challenge**: 把 WsFrame 协议映射到 QUIC streams;选 Go quic-go / Rust quinn
- **Target**: GA(G1.3)
- 原文 → [G1.3](../11-nsd-nsgw-vision/nsgw-vision.md#g13-quic-数据面)

### GW-CONN-002 · 无 Noise 数据面

- **Severity**: P3
- **Value**: DPI 严苛环境下作为 WSS / QUIC 替代
- **Target**: 企业级(G1.4)
- 原文 → [G1.4](../11-nsd-nsgw-vision/nsgw-vision.md#g14-noise-数据面)

### GW-CONN-003 · 无内置 STUN / TURN

- **Severity**: P2
- **Current**: 无 STUN(客户端探 NAT)、无 TURN(打洞失败兜底)
- **Target**: GA STUN(G1.7)/ 企业级 TURN(G1.8)
- 原文 → [G1.7](../11-nsd-nsgw-vision/nsgw-vision.md#g17-内置-stun) · [G1.8](../11-nsd-nsgw-vision/nsgw-vision.md#g18-内置-turn-兜底)

### GW-CONN-004 · UDP hole punch 仅 gerbil 有,mock 无

- **Severity**: P2
- **Current**: `tmp/gateway/relay/relay.go:27-33` 有 `HolePunchMessage`,mock 无
- **Impact**: 若以 mock 为参考走 SSE 契约,打洞能力丢失
- **Target**: MVP 对齐(路线 A 合并形态时带入)

### GW-CONN-005..007 · PROXY v2 / mTLS / SO_REUSEPORT

- 见各自原文条目 [G1.10](../11-nsd-nsgw-vision/nsgw-vision.md#g110-proxy-protocol-v2) · [G1.11](../11-nsd-nsgw-vision/nsgw-vision.md#g111-mtls-终结) · [G1.12](../11-nsd-nsgw-vision/nsgw-vision.md#g112-so_reuseport--多进程负载)

### GW-ROUTE-001 · 无 L4 任意端口映射

- **Severity**: P1(商业功能缺口)
- **Current**: gerbil 有 `SNIProxy`(`tmp/gateway/proxy/proxy.go`),但只做 SNI 嗅探 + `localSNIs` 白名单;没有"无 NSC 用户 `ssh nsgw:2222` 转发到 `nsn:22`"的能力
- **Required NSD contract**: 新 SSE `gateway_l4_map` 事件下发 `{listen_port, proto, target_nsn, target_port, acl_ref, allow_cidr, deny_cidr, geo_rules, conn_limits, audit_sink}`
- **Target**: MVP(SNI + 基础 L4 + IP 白名单 + 连接限速)/ GA(PROXY v2 + GeoIP + fail2ban)
- 原文 → [G2.3](../11-nsd-nsgw-vision/nsgw-vision.md#g23-sni--l4-端口映射)

### GW-ROUTE-002..006 · GeoDNS / Anycast / 热迁移 / 健康回落 / path 路由 / A/B

- 见 [G2.4](../11-nsd-nsgw-vision/nsgw-vision.md#g24-anycast-ip) · [G2.5](../11-nsd-nsgw-vision/nsgw-vision.md#g25-geodns) · [G2.6](../11-nsd-nsgw-vision/nsgw-vision.md#g26-跨网关热迁移) · [G2.7](../11-nsd-nsgw-vision/nsgw-vision.md#g27-路由优先级--回落) · [G2.8](../11-nsd-nsgw-vision/nsgw-vision.md#g28-path-based-routing) · [G2.9](../11-nsd-nsgw-vision/nsgw-vision.md#g29-header-based-routing) · [G2.10](../11-nsd-nsgw-vision/nsgw-vision.md#g210-ab-测试路由)

### GW-SEC-001..008 · 限速 / UDP flood / IP 信誉 / WAF / ZT / Resource auth / DDoS L7 / Slow loris

- 见 [G3.1](../11-nsd-nsgw-vision/nsgw-vision.md#g31-基础限速) · [G3.2](../11-nsd-nsgw-vision/nsgw-vision.md#g32-udp-flood-防御) · [G3.3](../11-nsd-nsgw-vision/nsgw-vision.md#g33-ip-信誉--crowdsec) · [G3.4](../11-nsd-nsgw-vision/nsgw-vision.md#g34-waf-基础) · [G3.7](../11-nsd-nsgw-vision/nsgw-vision.md#g37-零信任策略点-zt-proxy) · [G3.8](../11-nsd-nsgw-vision/nsgw-vision.md#g38-resource-级认证) · [G3.10](../11-nsd-nsgw-vision/nsgw-vision.md#g310-ddos-l7) · [G3.12](../11-nsd-nsgw-vision/nsgw-vision.md#g312-slow-loris-防护)

### GW-HA-001..005 · 热升级 / 蓝绿 / 跨区 failover / 会话快照 / 配置回滚

- 见 [G4.3](../11-nsd-nsgw-vision/nsgw-vision.md#g43-热升级-drain--swap) · [G4.4](../11-nsd-nsgw-vision/nsgw-vision.md#g44-蓝绿部署) · [G4.6](../11-nsd-nsgw-vision/nsgw-vision.md#g46-跨区-failover) · [G4.7](../11-nsd-nsgw-vision/nsgw-vision.md#g47-会话状态快照) · [G4.9](../11-nsd-nsgw-vision/nsgw-vision.md#g49-配置回滚)

### GW-OBS-001..007 · Prometheus / pprof auth / OTel / 访问日志 / WG 连接日志 / 拓扑 / 采样

- 见 [G5.1](../11-nsd-nsgw-vision/nsgw-vision.md#g51-prometheus-metrics) · [G5.2](../11-nsd-nsgw-vision/nsgw-vision.md#g52-pprof) · [G5.3](../11-nsd-nsgw-vision/nsgw-vision.md#g53-opentelemetry-traces) · [G5.4](../11-nsd-nsgw-vision/nsgw-vision.md#g54-结构化访问日志) · [G5.5](../11-nsd-nsgw-vision/nsgw-vision.md#g55-连接级日志-wg) · [G5.7](../11-nsd-nsgw-vision/nsgw-vision.md#g57-实时拓扑上报) · [G5.8](../11-nsd-nsgw-vision/nsgw-vision.md#g58-采样率控制)

### GW-RES-001..007 · org 配额 / QoS / tc-eBPF / 计费 / WSS 背压 / 连接数上限 / 过载降级

- 见 [G6.2](../11-nsd-nsgw-vision/nsgw-vision.md#g62-每-org-配额) · [G6.3](../11-nsd-nsgw-vision/nsgw-vision.md#g63-qos-分类-prod--dev--bulk) · [G6.4](../11-nsd-nsgw-vision/nsgw-vision.md#g64-linux-tc-整形) · [G6.5](../11-nsd-nsgw-vision/nsgw-vision.md#g65-ebpf-整形) · [G6.6](../11-nsd-nsgw-vision/nsgw-vision.md#g66-计费埋点) · [G6.7](../11-nsd-nsgw-vision/nsgw-vision.md#g67-wss-背压) · [G6.8](../11-nsd-nsgw-vision/nsgw-vision.md#g68-连接数上限-per-ip--per-user) · [G6.9](../11-nsd-nsgw-vision/nsgw-vision.md#g69-过载降级)

## 4. 相关但属于 NSN/NSC 侧的协议耦合问题

以下不是 NSGW 的 bug,但因与 NSGW 协议紧耦合,修复时需 NSGW 端配套动作(详见 [10 · roadmap §5 跨团队协调点](../10-nsn-nsc-critique/roadmap.md#5-跨团队协调点)):

| NSN/NSC 缺陷 | NSGW 端配套 | 协调点 |
| --- | --- | --- |
| [PERF-003 WSS 单 TCP 吞吐瓶颈](../10-nsn-nsc-critique/performance-concerns.md#perf-003--wss-单-tcp-吞吐瓶颈) | 识别 frame v2 多通道协商 | WS frame v2 spec |
| [FUNC-004 NSC WSS path 无 Bearer token](../10-nsn-nsc-critique/functional-gaps.md#func-004--nsc-wss-路径-bearer-token-注入未就位) | NSGW `/client` 握手校验 token 传递 | API 版本协商 |
| [SEC-004 会话 ID 重用预测](../10-nsn-nsc-critique/security-concerns.md#sec-004) | NSGW 侧生成 session ID 改随机 | 协议兼容 |
| [PERF-006 `READ_BUF = 8192`](../10-nsn-nsc-critique/performance-concerns.md#perf-006--relay_tcp-内部-read_buf--8192-硬编码与-nsgw-mtumss-无关) | 与 NSGW MTU/MSS 对齐;gerbil 的 `ensureMSSClamping` 要保留 | 配置一致性 |
| [FAIL-011 流量重定向 NAT 五元组](../10-nsn-nsc-critique/failure-modes.md#fail-011) | NSGW 切换时 ConntrackTable 需同步 | 迁移协议 |

## 5. NSD 契约新增(阻塞 NSGW 能力落地)

NSGW 许多能力需要 NSD 配套新增契约(详见 [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md)):

| NSGW 能力 | 依赖 NSD 契约 | 状态 |
| --------- | ------------- | ---- |
| L4 端口映射(SSH 等) | SSE `gateway_l4_map` | ❌ 待设计 |
| mTLS 终结 | NSD 下发 CA bundle | ❌ 待设计 |
| 零信任策略点 | `POST /api/v1/authz` | ❌ 待设计 |
| 每 org 配额 | NSD 下发配额配置 | ❌ 待设计 |
| 计费埋点 | `POST /api/v1/billing/ingest` | ❌ 待设计 |
| 跨网关热迁移 | NSD 协调 session 转移 | ❌ 待设计 |
| 拓扑上报 | `POST /api/v1/gateway/topology` | ❌ 待设计 |
| CA bundle 更新 | SSE `ca_bundle_update` | ❌ 待设计 |

## 6. 修复进度跟踪(补丁落地后在此标记)

| ID | 修复提交 / PR | 验收 |
| --- | --- | --- |
| (待填) | | |

---

相关原文:

- [10 · index](../10-nsn-nsc-critique/index.md) · 70+ 缺陷总索引
- [10 · architecture-issues](../10-nsn-nsc-critique/architecture-issues.md) · 10 条 ARCH
- [10 · functional-gaps](../10-nsn-nsc-critique/functional-gaps.md) · 12 条 FUNC
- [10 · failure-modes](../10-nsn-nsc-critique/failure-modes.md) · 11 条 FAIL
- [10 · performance-concerns](../10-nsn-nsc-critique/performance-concerns.md) · 11 条 PERF
- [10 · observability-gaps](../10-nsn-nsc-critique/observability-gaps.md) · 12 条 OBS
- [10 · security-concerns](../10-nsn-nsc-critique/security-concerns.md) · 15 条 SEC
- [10 · improvements](../10-nsn-nsc-critique/improvements.md) · 7 主题 fix proposal
- [11 · nsgw-capability-model §当前坐标](../11-nsd-nsgw-vision/nsgw-capability-model.md#当前坐标-baseline)
- [11 · nsgw-vision](../11-nsd-nsgw-vision/nsgw-vision.md) · 六大能力轴 40+ 功能
