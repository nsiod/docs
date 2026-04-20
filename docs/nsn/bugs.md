# NSN · 已知缺陷与改进项

> 本页是 [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 70+ 缺陷中**与 NSN 相关**部分的精简索引。每条缺陷给出严重度、一句话症状、源码位置与原文锚点。
>
> NSC-only 缺陷在 §7 单列。审查依据:HEAD 2026-04-16(18,037 行 Rust,12 crate)。
>
> 字段约定:**P0** = 安全 / 可用性危及生产 / 数据丢失;**P1** = 严重影响功能或运维;**P2/P3** = 待优化。

## 1. P0 必修(8 项)

| ID | 一句话 | crate / 位置 | 原文 |
| --- | --- | --- | --- |
| [SEC-001](#sec-001) | ACL 双 Arc + 语义不对称(WSS fail-CLOSED, 本地 fail-OPEN) | `nat/router.rs:88+`, `connector/lib.rs:80` | [SEC-001](../10-nsn-nsc-critique/security-concerns.md#sec-001) |
| [SEC-002](#sec-002) | `to_http_base()` 把 `noise://` / `quic://` 改写为 **http://**(非 https) — 凭据明文 | `control/auth.rs:15-23` | [SEC-002](../10-nsn-nsc-critique/security-concerns.md#sec-002) |
| [SEC-005](#sec-005) `[RESOLVED]` | 多 NSD 合并交集 + 任一推空 ACL → 清空全局策略(已决议改并集 + 本地保底) | `control/merge.rs:85-145` | [SEC-005](../10-nsn-nsc-critique/security-concerns.md#sec-005) |
| [SEC-008](#sec-008) | ACL 加载 10s 超时后继续启动(启动期 fail-open 窗口) | `nsn/main.rs:790-880` | [SEC-008](../10-nsn-nsc-critique/security-concerns.md#sec-008) |
| [SEC-014](#sec-014) | `acl_engine` 写两份,部分失败无回滚 → 策略不一致 | `nsn/main.rs:1464` | [SEC-014](../10-nsn-nsc-critique/security-concerns.md#sec-014) |
| [FUNC-005](#func-005) | `ConntrackTable` 无 GC / TTL / cap → 长跑 OOM,可被攻击放大 | `nat/packet_nat.rs:78` | [FUNC-005](../10-nsn-nsc-critique/functional-gaps.md#func-005) |
| [ARCH-001](#arch-001) | ACL 引擎多份持有,语义不统一(同 SEC-001 的架构面) | `nat/router.rs:40`, `connector/lib.rs:80` | [ARCH-001](../10-nsn-nsc-critique/architecture-issues.md#arch-001) |
| [ARCH-002](#arch-002) `[RESOLVED]` | 多 NSD ACL 交集合并制造"空配置攻击面"(已决议反转) | `control/merge.rs` | [ARCH-002](../10-nsn-nsc-critique/architecture-issues.md#arch-002) |

## 2. 架构问题 ARCH · 8 条(NSN 视角)

### ARCH-001
**ACL 引擎多份持有,语义不统一** — `nat::ServiceRouter::acl_engine` 与 `connector::ConnectorManager::acl` 各持一份 `Arc<AclEngine>`,`load_acl_config_for_runtime` 同时写两份但失败时无回滚。原文 → [ARCH-001](../10-nsn-nsc-critique/architecture-issues.md#arch-001)

### ARCH-002 `[RESOLVED]`
**多 NSD ACL 合并使用交集** — 任一 NSD 推空 ACL 即清空全局策略;已决议改并集 + 本地 ACL 保底。原文 → [ARCH-002](../10-nsn-nsc-critique/architecture-issues.md#arch-002)

### ARCH-003
**两套 TCP relay 并存** — `nsn/src/main.rs` 的 `relay_*_connection` 与 `proxy::handle_tcp_connection` 实现了功能重叠的两套 TCP relay,生产路径只走前者。原文 → [ARCH-003](../10-nsn-nsc-critique/architecture-issues.md#arch-003)

### ARCH-004
**MultiGatewayManager 健康检查被 dead_code 遮蔽** — `health_interval` 字段标 `#[allow(dead_code)]`,30s 周期不驱动任何代码,Failed gateway 不退避重连。原文 → [ARCH-004](../10-nsn-nsc-critique/architecture-issues.md#arch-004)

### ARCH-006
**main.rs 入口臃肿** — 30+ tasks 装配集中在 `main.rs:300-1100`,妨碍单元测试。原文 → [ARCH-006](../10-nsn-nsc-critique/architecture-issues.md#arch-006)

### ARCH-007
**`tunnel-wg::AclFilteredSend` 是死代码** — 形式上是抽象层,实际仅自身 test 引用,`nsn/main.rs` 未装配。原文 → [ARCH-007](../10-nsn-nsc-critique/architecture-issues.md#arch-007)

### ARCH-008
**控制面 HTTP API 与可插拔 transport 解耦不彻底** — `register/auth/heartbeat` 4 个 API 始终走 `to_http_base()`,绕过 Noise / QUIC transport。原文 → [ARCH-008](../10-nsn-nsc-critique/architecture-issues.md#arch-008)

### ARCH-009
**connector 选路与 tunnel-ws 单 TCP 强耦合** — 选路策略假设单条 TCP socket,扩多 TCP 必须协议改造。原文 → [ARCH-009](../10-nsn-nsc-critique/architecture-issues.md#arch-009)

### ARCH-010
**`ServicesConfig` 与 `AclConfig` 缺乏交叉校验** — 两套独立校验链,无 cross-config 一致性检查。原文 → [ARCH-010](../10-nsn-nsc-critique/architecture-issues.md#arch-010)

## 3. 功能缺口 FUNC · 8 条(NSN 视角)

### FUNC-005
**`ConntrackTable` 无 GC / TTL / cap** — 仅有 `insert`,长跑 OOM,P0。原文 → [FUNC-005](../10-nsn-nsc-critique/functional-gaps.md#func-005)

### FUNC-006
**全栈仅支持 IPv4** — netstack/nat/wg 全部 v4-only,smoltcp 支持但未启用,WSS Open frame 仅 `V4Addr`。重做 ~15 人日。原文 → [FUNC-006](../10-nsn-nsc-critique/functional-gaps.md#func-006)

### FUNC-007
**NSGW 健康检查未真正定时执行** — `MultiGatewayManager` connector 端的 dead_code(同 ARCH-004)。原文 → [FUNC-007](../10-nsn-nsc-critique/functional-gaps.md#func-007)

### FUNC-008
**`AclFilteredSend::is_packet_allowed` 名实不符** — 实际策略是"任何 TCP/UDP IPv4 都过",未真接 ACL。原文 → [FUNC-008](../10-nsn-nsc-critique/functional-gaps.md#func-008)

### FUNC-009
**`services_ack` 不被消费** — NSD 回应的 `matched/unmatched/rejected` 不会回写 `AppState`,运维无法在 monitor 看到。原文 → [FUNC-009](../10-nsn-nsc-critique/functional-gaps.md#func-009)

### FUNC-010
**心跳 `local_ips` 启动期一次性快照** — 网卡 IP 变化运行期不感知。原文 → [FUNC-010](../10-nsn-nsc-critique/functional-gaps.md#func-010)

### FUNC-011
**`proxy::handle_tcp_connection` 生产未调用** — 与 ARCH-003 配对的"另一半 dead code"。原文 → [FUNC-011](../10-nsn-nsc-critique/functional-gaps.md#func-011)

(FUNC-001/002/003/004/012 是 NSC-only,见 §7。)

## 4. 故障模式 FAIL · 11 条(全部影响 NSN)

| ID | 症状 | 原文 |
| --- | --- | --- |
| FAIL-001 | 任意 spawn task panic 不被父任务感知,无重启策略 | [FAIL-001](../10-nsn-nsc-critique/failure-modes.md#fail-001) |
| FAIL-002 | `acl_config_rx` 启动期 10s 超时后继续运行,ACL 永久缺失 | [FAIL-002](../10-nsn-nsc-critique/failure-modes.md#fail-002) |
| FAIL-003 | WSS 单连接 head-of-line blocking,所有流共享一条 TCP | [FAIL-003](../10-nsn-nsc-critique/failure-modes.md#fail-003) |
| FAIL-004 | `ConnectorManager::run` WSS→UDP 升级时 abort 中断所有 WSS 流 | [FAIL-004](../10-nsn-nsc-critique/failure-modes.md#fail-004) |
| FAIL-005 | 反向 NAT miss 静默丢包,无 metric 无 log | [FAIL-005](../10-nsn-nsc-critique/failure-modes.md#fail-005) |
| FAIL-006 `[RESOLVED]` | 多 NSD ACL 交集 + 单 NSD 空 → 全局策略清空(同 ARCH-002) | [FAIL-006](../10-nsn-nsc-critique/failure-modes.md#fail-006) |
| FAIL-007 | 控制面 backoff 指数退避时 token 可能过期,重连后 401 再退避 | [FAIL-007](../10-nsn-nsc-critique/failure-modes.md#fail-007) |
| FAIL-008 | 大量未消费 mpsc 长跑后背压上游而不暴露 | [FAIL-008](../10-nsn-nsc-critique/failure-modes.md#fail-008) |
| FAIL-009 | `proxy_done_rx` 容量 1,WSS proxy 异常退出后不重连 | [FAIL-009](../10-nsn-nsc-critique/failure-modes.md#fail-009) |
| FAIL-010 | `JoinHandle.abort()` 升级 / shutdown 时不等 task 清理 | [FAIL-010](../10-nsn-nsc-critique/failure-modes.md#fail-010) |
| FAIL-011 | 本地服务慢响应时 `relay_*_connection` 永久 await | [FAIL-011](../10-nsn-nsc-critique/failure-modes.md#fail-011) |

## 5. 可观测性 OBS · 12 条

| ID | 一句话 | 原文 |
| --- | --- | --- |
| OBS-001 | 全局 OTel meter 注册后**从未被任何 crate 使用** | [OBS-001](../10-nsn-nsc-critique/observability-gaps.md#obs-001) |
| OBS-002 | `TunnelMetrics` 双重定义,两个互不相关的同名 struct | [OBS-002](../10-nsn-nsc-critique/observability-gaps.md#obs-002) |
| OBS-003 | NAT 反向查找 miss / 静默丢包没有任何 metric | [OBS-003](../10-nsn-nsc-critique/observability-gaps.md#obs-003) |
| OBS-004 | mpsc / ws_frame 缓冲区**占用率**没有任何 metric | [OBS-004](../10-nsn-nsc-critique/observability-gaps.md#obs-004) |
| OBS-005 | 无 span / 无 trace_id / 无跨调用上下文传播 | [OBS-005](../10-nsn-nsc-critique/observability-gaps.md#obs-005) |
| OBS-006 | 没有任何 histogram / latency 分布指标 | [OBS-006](../10-nsn-nsc-critique/observability-gaps.md#obs-006) |
| OBS-007 | `/api/metrics` 由 `format!()` 字符串拼接生成,无类型 / 标签校验 | [OBS-007](../10-nsn-nsc-critique/observability-gaps.md#obs-007) |
| OBS-008 | ACL deny 事件不计数,只暂存 VecDeque,/api/metrics 不暴露 | [OBS-008](../10-nsn-nsc-critique/observability-gaps.md#obs-008) |
| OBS-009 | panic / spawn 失败 / task 提前退出无可观测信号 | [OBS-009](../10-nsn-nsc-critique/observability-gaps.md#obs-009) |
| OBS-010 | NSC 完全没有指标端点(NSC-only) | [OBS-010](../10-nsn-nsc-critique/observability-gaps.md#obs-010) |
| OBS-011 | 无 SLI/SLO 定义和文档 | [OBS-011](../10-nsn-nsc-critique/observability-gaps.md#obs-011) |
| OBS-012 | tracing 文件 appender daily rolling,无大小上限 / 无压缩 / 无清理 | [OBS-012](../10-nsn-nsc-critique/observability-gaps.md#obs-012) |

## 6. 性能问题 PERF · 10 条

| ID | 一句话 | 原文 |
| --- | --- | --- |
| PERF-001 | `check_target_allowed` 每帧 Open 都拿 RwLock,并发评估能力受限 | [PERF-001](../10-nsn-nsc-critique/performance-concerns.md#perf-001) |
| PERF-002 | WSS data 帧每次 `Vec::to_vec()` 拷贝,可零拷贝 | [PERF-002](../10-nsn-nsc-critique/performance-concerns.md#perf-002) |
| PERF-003 | tunnel-ws 单 TCP socket 是吞吐天花板 | [PERF-003](../10-nsn-nsc-critique/performance-concerns.md#perf-003) |
| PERF-004 | gotatun 单线程加解密,多核 CPU 利用率受限 | [PERF-004](../10-nsn-nsc-critique/performance-concerns.md#perf-004) |
| PERF-005 | WSS 模式下 `connector::probe_udp` 每 300s 触发完整握手 | [PERF-005](../10-nsn-nsc-critique/performance-concerns.md#perf-005) |
| PERF-006 | `relay_tcp` `READ_BUF = 8192` 硬编码,与 NSGW MTU 无关 | [PERF-006](../10-nsn-nsc-critique/performance-concerns.md#perf-006) |
| PERF-007 | `Arc<RwLock<Option<Arc<AclEngine>>>>` 三层间接 | [PERF-007](../10-nsn-nsc-critique/performance-concerns.md#perf-007) |
| PERF-008 | services 严格模式每次 WSS Open 都做 DNS resolve | [PERF-008](../10-nsn-nsc-critique/performance-concerns.md#perf-008) |
| PERF-009 | `serde_json` 在 monitor 高频请求路径上无 cache | [PERF-009](../10-nsn-nsc-critique/performance-concerns.md#perf-009) |
| PERF-010 | `MultiGatewayManager` 选路 O(N) 线性遍历 | [PERF-010](../10-nsn-nsc-critique/performance-concerns.md#perf-010) |

## 7. 安全问题 SEC · 15 条

### 与 NSN 直接相关(11 条)

| ID | 一句话 | 严重度 | 原文 |
| --- | --- | --- | --- |
| SEC-001 | ACL 引擎语义不对称:WSS fail-CLOSED, 本地服务路由 fail-OPEN | P0 | [SEC-001](../10-nsn-nsc-critique/security-concerns.md#sec-001) |
| SEC-002 | `to_http_base()` 在 noise/quic 部署下静默降级到明文 HTTP | P0 | [SEC-002](../10-nsn-nsc-critique/security-concerns.md#sec-002) |
| SEC-003 | `authenticate` 签名仅含本地时间戳,无 server nonce → 重放窗口 | P1 | [SEC-003](../10-nsn-nsc-critique/security-concerns.md#sec-003) |
| SEC-004 | 身份密钥 `machinekey.json` 明文 hex JSON 落盘 | P1 | [SEC-004](../10-nsn-nsc-critique/security-concerns.md#sec-004) |
| SEC-005 `[RESOLVED]` | 多 NSD 交集合并:任一推空 ACL 即清空 | P0 | [SEC-005](../10-nsn-nsc-critique/security-concerns.md#sec-005) |
| SEC-007 | WSS Open frame 缺地址范围限制,可作 SSRF 跳板 | P1 | [SEC-007](../10-nsn-nsc-critique/security-concerns.md#sec-007) |
| SEC-008 | ACL 加载 10s 超时后继续启动(fail-open 启动窗口) | P0 | [SEC-008](../10-nsn-nsc-critique/security-concerns.md#sec-008) |
| SEC-009 | Bearer token 多处 `format!()` 拼接,可能进日志 | P1 | [SEC-009](../10-nsn-nsc-critique/security-concerns.md#sec-009) |
| SEC-012 | QUIC 信任完全基于 SHA-256 fingerprint pinning,无法轮换吊销 | P2 | [SEC-012](../10-nsn-nsc-critique/security-concerns.md#sec-012) |
| SEC-013 `[RESOLVED]` | NSGW 推送的 WSS Open frame 缺 source identity(已决议加 TLV) | P1 | [SEC-013](../10-nsn-nsc-critique/security-concerns.md#sec-013) |
| SEC-014 | `acl_engine` 写两份,部分失败无回滚 → 策略不一致 | P0 | [SEC-014](../10-nsn-nsc-critique/security-concerns.md#sec-014) |
| SEC-015 | 没有审计日志 / 没有"安全事件"流出口 | P1 | [SEC-015](../10-nsn-nsc-critique/security-concerns.md#sec-015) |

### NSC-only(4 条,记录但不在 NSN 范围内)

`SEC-006` NSC 没出站 ACL · `SEC-010` NSC `_token_rx` 被丢弃 · `SEC-011` OAuth2 token 仅内存 · 详见原文。

## 8. NSC-only 缺陷(供对照参考)

NSN 与 NSC 共享 `crates/control` / `crates/acl` / `crates/tunnel-*`,所以 NSC 的某些缺陷会反向影响 NSN 的部署形态(例如 NSC 无 ACL → NSN 必须把所有访问当 untrusted 来设计):

| ID | 一句话 | 原文 |
| --- | --- | --- |
| FUNC-001 | NSC `--data-plane tun` 只换 VIP 前缀,**未建 TUN 设备** | [FUNC-001](../10-nsn-nsc-critique/functional-gaps.md#func-001) |
| FUNC-002 | `nsc --device-flow` 直接 `bail!`,但 `device_flow` crate 已实现 | [FUNC-002](../10-nsn-nsc-critique/functional-gaps.md#func-002) |
| FUNC-003 | `nsc status` 只 print 占位文本 | [FUNC-003](../10-nsn-nsc-critique/functional-gaps.md#func-003) |
| FUNC-004 | NSC `_token_rx` 显式丢弃 → token 长跑刷新失效 | [FUNC-004](../10-nsn-nsc-critique/functional-gaps.md#func-004) |
| FUNC-012 | NSC 没有出站 ACL,`AclConfig` 仅约束 NSN 侧 | [FUNC-012](../10-nsn-nsc-critique/functional-gaps.md#func-012) |
| ARCH-005 | NSC 主循环只 select 3 路 SSE,忽略 4 路接收器 | [ARCH-005](../10-nsn-nsc-critique/architecture-issues.md#arch-005) |
| OBS-010 | NSC 完全没有指标端点 | [OBS-010](../10-nsn-nsc-critique/observability-gaps.md#obs-010) |
| SEC-006 | NSC 完全没有出站 ACL | [SEC-006](../10-nsn-nsc-critique/security-concerns.md#sec-006) |
| SEC-010 | NSC token 刷新通道丢弃 | [SEC-010](../10-nsn-nsc-critique/security-concerns.md#sec-010) |

## 9. 半成品 / dead_code 一览

来自 [10 · current-state §8](../10-nsn-nsc-critique/current-state.md#8-半成品--dead_code-一览):

| 位置 | 现象 |
| --- | --- |
| `connector/multi.rs:156-157` | `health_interval` `#[allow(dead_code)]`,30s 周期未驱动 |
| `tunnel-wg/acl_ip_adapter.rs` | `AclFilteredSend` 整模块只被自身 test 引用 |
| `nat/packet_nat.rs:78` | `ConntrackTable` 仅有 insert,无 cleanup / TTL / 上限 |
| `nsc/main.rs:138` | `Status` 子命令明文 TODO |
| `nsc/main.rs:172` | `--device-flow` 直接 `bail!("not yet implemented")` |
| `nsc/main.rs:195` | `_wg_rx, _proxy_rx, _acl_rx, _token_rx` 用下划线显式丢弃 |

## 10. 缺陷汇总(按 crate)

| crate | P0 | P1 | P2/P3 | 主要问题 |
| --- | --- | --- | --- | --- |
| `nsn` | 2 | 4 | 8 | main.rs 装配臃肿 + 启动 fail-open 窗口 |
| `nsc` | 1 | 5 | 4 | 多 CLI 半成品 + 无 ACL |
| `control` | 2 | 3 | 6 | HTTP API 旁路 transport + auth 重放 + 多 NSD 合并 |
| `tunnel-ws` | 0 | 3 | 5 | 单 TCP HOL + frame 缺 source + WSS upgrade 不安全 |
| `tunnel-wg` | 0 | 0 | 3 | AclFilteredSend 死代码 |
| `nat` | 1 | 2 | 4 | conntrack 无 GC + ServiceRouter fail-open |
| `connector` | 1 | 2 | 4 | health_interval 死代码 + proxy_done 容量 1 |
| `acl` | 0 | 1 | 2 | 无 metric / 评估时序 |
| `telemetry` | 0 | 0 | 3 | OTel 空跑 + 重复 struct |
| `common` | 0 | 1 | 1 | 私钥明文落盘 |
| `proxy` | 0 | 0 | 2 | 生产未使用 |
| `netstack` | 0 | 0 | 1 | smoltcp 调参未做 |

## 11. 改造主题与路线

70+ 缺陷在 [improvements.md](../10-nsn-nsc-critique/improvements.md) 收敛为 **7 个主题**(Theme A~G,~69 人日):

- **Theme A** · ACL/Policy 重整(最高优先,12 人日)
- **Theme B** · 控制面安全(10 人日)
- **Theme C** · 可观测性栈统一(14 人日)
- **Theme D** · 数据面健壮性(10 人日)
- **Theme E** · 半成品收尾(4 人日)
- **Theme F** · 入口拆分与解耦(11 人日)
- **Theme G** · 性能优化(8 人日)

排期与依赖关系详见 [roadmap.md](./roadmap.md);具体 fix proposal 与缺陷反向索引详见 [improvements.md §1-2](../10-nsn-nsc-critique/improvements.md#1-主题级-fix-proposals)。

---

更详细的 9-字段缺陷描述(Severity / Location / Current / Why-defect / Impact / Fix / Cost-Benefit / Migration-risk)见原章节:

- [10 · architecture-issues.md](../10-nsn-nsc-critique/architecture-issues.md) · 10 条 ARCH
- [10 · functional-gaps.md](../10-nsn-nsc-critique/functional-gaps.md) · 12 条 FUNC
- [10 · failure-modes.md](../10-nsn-nsc-critique/failure-modes.md) · 11 条 FAIL
- [10 · performance-concerns.md](../10-nsn-nsc-critique/performance-concerns.md) · 10 条 PERF
- [10 · observability-gaps.md](../10-nsn-nsc-critique/observability-gaps.md) · 12 条 OBS
- [10 · security-concerns.md](../10-nsn-nsc-critique/security-concerns.md) · 15 条 SEC
- [10 · improvements.md](../10-nsn-nsc-critique/improvements.md) · 7 主题 fix proposal
- [10 · methodology.md](../10-nsn-nsc-critique/methodology.md) · 评分口径与缺陷格式
