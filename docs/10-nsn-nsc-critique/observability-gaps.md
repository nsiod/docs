# 可观测性缺陷清单 · NSN + NSC

> 评审范围：metrics 覆盖、tracing 结构、日志可用性、debug 友好度、SLI/SLO 缺位。
> 评分口径：见 [methodology.md](./methodology.md)。

## 0. 一图速览：当前可观测性栈与现实差距

[可观测性栈 · 声明 vs 实际差距](./diagrams/obs-stack-gap.d2)

**核心矛盾**：仓库引入了 `opentelemetry`、`opentelemetry_sdk`、`opentelemetry-prometheus` 三个依赖，但**没有任何 crate 调用 `opentelemetry::global::meter("...")` 来创建 instrument**。Prometheus 暴露的指标全部走 `format!()` 字符串路径——而不是 OTel pipeline。

---

## OBS-001 · 全局 OTel meter 注册后从未被任何 crate 使用

- **Severity**: P2（中）
- **Location**: `crates/telemetry/src/lib.rs:31-40`；缺失方：`crates/{nat,connector,tunnel-ws,tunnel-wg,proxy,acl,control}/src/**`
- **Current behavior**：
  - `init_telemetry()` 创建 `Registry` → `prometheus::exporter` → `SdkMeterProvider` → 注册为全局 meter provider
  - 全仓库 `grep -rn "opentelemetry::global::meter\|create_counter\|create_histogram\|create_gauge\|create_observable"` 在业务 crate 中**0 命中**
  - 仅 `telemetry/src/lib.rs` 自身和 `nsn/src/main.rs:261` 调用 `init_telemetry()` 一次
- **Why it's a defect**：注册了一条 OTel pipeline 却不向其推送数据。`/api/metrics` 中所有真实指标都来自 `monitor.rs:344-375` 的 `format!()` 字符串拼接，OTel 部分输出的 `metric_families.gather()` 永远是**空集**（`monitor.rs:316-319`）。这是"假装在做但没做"的典型反模式。
- **Impact**：
  - 引入 ~3 MB 二进制体积（OTel SDK + Prometheus exporter）但功能为零
  - 误导运维：以为接入了标准 OTel，实际无法用 OTel collector + 后端去聚合
  - 阻塞后续接入分布式 tracing（OTel meter / tracer 应共享 SdkProvider）
- **Fix**：
  - **方案 A（推进 OTel）**：在 `telemetry::metrics` 中改造 `ProxyMetrics`/`TunnelMetrics`，改用 `meter.u64_counter("nsn_bytes_tx").build()`、`meter.u64_observable_gauge("nsn_active_connections").with_callback(...)` 等真正的 OTel instrument；删除 `monitor.rs:344-375` 的手写拼接
  - **方案 B（拆掉 OTel）**：保留 `prometheus::Registry` 和手写路径，移除 OTel 依赖（`Cargo.toml` 中 `opentelemetry*`）。如果团队没有打算接 OTel collector，这是最诚实的选择
  - 推荐 A，因为它为 SEC-审计日志 / FAIL-005（NAT 丢包）/ OBS-006（histogram）打开统一通道
- **Cost vs Benefit**：方案 A ~5 人日（每个 crate 引入 meter 静态量 + callback），benefit 是后续所有 OBS-* 缺陷有统一落点；方案 B ~0.5 人日，benefit 是诚实地降低复杂度
- **Migration risk**：低；`/api/metrics` 文本格式不变，只是数据来源切换

---

## OBS-002 · `TunnelMetrics` 双重定义,两个互不相关的 struct 同名

- **Severity**: P3（低）
- **Location**:
  - `crates/telemetry/src/metrics.rs:26-45`（`telemetry::metrics::TunnelMetrics`，含 `wg_handshakes`/`wg_rx_bytes`/`wg_tx_bytes`/`last_handshake` 4 个 atomic）
  - `crates/nsn/src/state.rs:101-112`（`nsn::state::TunnelMetrics`，含 `gateway_id`/`endpoint`/`virtual_ip`/`handshakes`/`bytes_tx`/`bytes_rx`/`keepalive_interval` 7 个字段，普通 struct）
  - 实际写入位置 `crates/nsn/src/main.rs:985`：`state::TunnelMetrics { ... }`，**完全不用** `telemetry::metrics::TunnelMetrics`
- **Why it's a defect**：
  - 同名 struct 让阅读者困惑哪个才是"真"指标
  - `telemetry::metrics::TunnelMetrics` 的 4 个 atomic counter 是 dead code（grep 显示仅在自身 test 中使用）
  - `nsn::state::TunnelMetrics` 不是 atomic，是周期性整体替换（每次 `or_insert_with` 创建新实例），不能在并发读取时获得一致快照
- **Impact**：开发者修改任一处都会怀疑另一处该不该同步；实际上根本不需要两份
- **Fix**：删除 `telemetry::metrics::TunnelMetrics`（含 test），保留 `nsn::state::TunnelMetrics`；在 OBS-001 方案 A 推进时,`state::TunnelMetrics` 的字段直接绑到 OTel observable gauge 的 callback 上
- **Cost vs Benefit**：~1 小时；消除一个明显的认知陷阱
- **Migration risk**：无；`telemetry::metrics::TunnelMetrics` 没有任何外部使用者

---

## OBS-003 · NAT 反向查找 miss / 静默丢包没有任何 metric

- **Severity**: P1（高）
- **Location**: `crates/nat/src/packet_nat.rs`（`HybridNatRecv::process` 路径）；`crates/nsn/src/main.rs` netstack 接收回路
- **Current behavior**：当反向 NAT 表中找不到映射条目时，packet 被丢弃，没有计数器记录。详情见 [FAIL-005](./failure-modes.md#fail-005)。`NatStats`（`nsn/src/state.rs:117-124`）只追踪 `total_created`/`total_expired`/`active_entries`/`bytes_tx`/`bytes_rx`，无 `miss_count`/`drop_count`
- **Why it's a defect**：现场 troubleshooting "为什么客户端连不上"时，运维只能看到 `bytes_rx` 没增长，无法区分"流量根本没到"vs"到了但 NAT 表丢了"
- **Impact**：
  - 故障定位时间 +2~4 小时（必须 attach tcpdump + RUST_LOG=trace）
  - 自动告警无法识别"连接黑洞"
- **Fix**：
  - 在 `NatStats` 增加 `pub reverse_lookup_miss: AtomicU64`、`pub forward_table_full: AtomicU64`
  - 在 packet_nat.rs 的 miss / 丢弃路径上 `fetch_add(1)`
  - 在 `monitor.rs` `/api/metrics` 增加 `nsn_nat_reverse_miss_total` 和 `nsn_nat_drops_total`
- **Cost vs Benefit**：~0.5 人日；高 ROI（直接缩短 MTTR）
- **Migration risk**：无

---

## OBS-004 · mpsc / ws_frame 缓冲区**占用率**没有任何 metric

- **Severity**: P2（中）
- **Location**: 全仓库；详情见 [FAIL-008](./failure-modes.md#fail-008)。涉及通道：
  - `WsTunnel::write_tx`（容量 256，`tunnel-ws/src/lib.rs:243`）
  - 单 stream `data_tx`（容量 64，`tunnel-ws/src/lib.rs:589`）
  - `tunnel-wg::decrypted_tx` / `to_encrypt_tx`（容量 256）
  - `MultiGatewayManager::event_tx`（**try_send 静默丢**，`connector/multi.rs:190-194`）
- **Current behavior**：所有 mpsc 都是 `tokio::sync::mpsc::channel(N)`，无 `Sender::capacity()` 暴露；满了之后 `await` 阻塞或 `try_send` 丢弃，**无任何指标**
- **Why it's a defect**：backpressure 是分布式系统第一个容量瓶颈来源；不可观测 = 在生产被 OOM / 拥塞前没有预警信号
- **Impact**：
  - 拥塞早期信号丢失：例如 `WsTunnel::write_tx` 持续满 → 上游 `flush_packets` 卡住，但不会触发任何告警，直到 TCP 缓冲区也满 → keepalive 失败 → tunnel 断开
  - "为什么这次延迟突然 200ms" 类问题无解
- **Fix**：
  - 封装 `MeteredSender<T>` 包裹 `mpsc::Sender<T>`，每次 `try_send`/`send` 前后采样 `capacity()` 写入 OTel observable gauge `nsn_channel_pending{name=...}`
  - 同时记录 `nsn_channel_dropped_total{name=...}`（专给 try_send 路径）
- **Cost vs Benefit**：~1 人日（封装 + 替换调用点）；为 P0/P1 故障提供早期信号
- **Migration risk**：低；纯 wrapper 改造

---

## OBS-005 · 无 span / 无 trace_id / 无任何跨调用上下文传播

- **Severity**: P2（中）
- **Location**: 全仓库 `info!`/`warn!`/`error!` 调用点（约 200+ 处）
- **Current behavior**：
  - `crates/nsn/src/main.rs:241-256` 仅注册 `fmt::layer()` + 可选 `fmt::layer().json()`
  - `tracing` 宏只输出 message + structured field，没有任何 `tracing::Span::current()` 上下文
  - 仅 `crates/control/src/{auth,sse}.rs` 有 6 个 `#[instrument]`（grep 命中）
  - 所有跨任务通信（spawn / mpsc / oneshot）**不传递 span**，task 之间日志无法关联
- **Why it's a defect**：
  - 一个用户连接走过：device flow → auth → SSE register → load wg config → connect NSGW → WSS open frame → service router → NAT translate → upstream connect — 当出问题时，运维要拿 grep "<random IP/port>" 在日志里手工拼时间线
  - 无法做 "p99 端到端连接建立耗时" 类指标
- **Impact**：
  - 跨组件 debug 困难（每条日志是孤岛）
  - 不可能集成 Jaeger/Tempo/Datadog APM
- **Fix**：
  - 在每个入口任务（NSGW connect、SSE config 接收、ws frame dispatch）创建 root span，绑定 `gateway_id` / `connection_id` / `frame_seq`
  - 用 `tracing::Instrument::instrument(span)` 把 spawn 的 future 包起来,确保日志带 span 上下文
  - 在 OTel SdkProvider 上同时配 tracer，未来导出到 OTLP collector
- **Cost vs Benefit**：~3 人日；显著降低生产 debug 成本
- **Migration risk**：低；增加日志字段不破坏既有解析

---

## OBS-006 · 没有任何 histogram / latency 分布指标

- **Severity**: P1（高）
- **Location**: 全仓库；`grep histogram\|Histogram` 在生产代码 0 命中（仅 prometheus 依赖里有定义）
- **Current behavior**：所有暴露的指标都是 `gauge` 或 `counter`，没有任何 `histogram`/`summary`
- **Why it's a defect**：以下问题**无法回答**：
  - WSS Open frame 到第一字节回传的 p50/p95/p99 是多少？
  - ACL `is_allowed` 评估单次耗时的分布？
  - SSE `dispatch_message` 处理时长？
  - tunnel-wg 加解密单包延迟？
  - HTTP `register`/`authenticate` 调用 RTT？
  - `effective_acl_config` 合并的耗时（多 NSD 场景）？
- **Impact**：无法定义 SLO（"99% Open frame 延迟 < 100ms"），无法识别 long-tail latency 攻击或退化
- **Fix**：
  - 在 OBS-001 方案 A 落地时，每个关键路径加 `meter.f64_histogram("nsn_xxx_seconds").with_unit("s").build()`
  - 关键路径清单：
    - `dispatch_frame.open` 延迟（tunnel-ws/lib.rs:486）
    - `is_allowed` 评估延迟（acl/matcher）
    - `ServiceRouter::resolve` 总耗时（nat/router.rs:71）
    - `MultiControlPlane::dispatch_message` 处理耗时
    - `tunnel-wg encrypt/decrypt` 单包耗时（可采样）
- **Cost vs Benefit**：~2 人日（前提是 OBS-001 已落地）；解锁 SLO 定义
- **Migration risk**：无

---

## OBS-007 · `/api/metrics` 由 `format!()` 字符串拼接生成,无类型/标签校验

- **Severity**: P3（低）
- **Location**: `crates/nsn/src/monitor.rs:344-375`
- **Current behavior**：
  ```rust
  otel_text.push_str(&format!(
      "# HELP nsn_uptime_seconds Process uptime in seconds\n\
       # TYPE nsn_uptime_seconds gauge\n\
       nsn_uptime_seconds {uptime}\n\
       # HELP nsn_bytes_tx_total Total bytes transmitted through the tunnel\n\
       # TYPE nsn_bytes_tx_total counter\n\
       ...
  ));
  ```
- **Why it's a defect**：
  - 命名错一个字符就静默通过 prometheus parser 但成为新 series
  - 没有 label 维度（例：`nsn_bytes_tx_total{gateway="..."}`），无法切片分析
  - 添加新指标必须改这段拼接 + 改 OTel + 改 monitor.rs，3 处不同步
  - 单元测试无法 import `prometheus::Encoder` 验证
- **Impact**：
  - 维护成本随指标数量平方上升
  - 阻塞引入 cardinality（标签维度）
- **Fix**：在 OBS-001 方案 A 落地时一并删除；所有指标走 `prometheus::IntGauge::with_label_values(...)` 或 OTel instrument
- **Cost vs Benefit**：随 OBS-001 顺手处理；~2 小时
- **Migration risk**：无（输出文本格式不变）

---

## OBS-008 · ACL deny 事件不计数,只暂存 VecDeque,/api/metrics 不暴露

- **Severity**: P2（中）
- **Location**: `crates/nsn/src/state.rs:128-145`（`AclDenial` + `AclState::recent_denials`，cap=`MAX_ACL_DENIALS`）；`crates/nsn/src/monitor.rs` 仅 `/api/acl` 路径返回 `recent_denials`
- **Current behavior**：每次 ACL 拒绝 push 一条记录到 `recent_denials: VecDeque`（容量上限），通过 `/api/acl` JSON 暴露最近 N 条原文；**无 counter/gauge 反映拒绝速率**
- **Why it's a defect**：
  - 安全告警必须是数值（速率超阈值则告警），而不是要轮询 N 条 JSON 自己 diff
  - 短时大量被拒（被攻击或配置错误）的事件可能在两次 `/api/acl` 轮询间被 VecDeque 挤掉
  - 无法在 Grafana 上画"ACL 拒绝率"
- **Impact**：
  - 安全可观测性弱：策略下发错误导致大量拒绝时,可能 30 分钟后才被发现
  - 不能用于检测 SEC-审计需求（规则被绕过时）
- **Fix**：
  - 增加 `nsn_acl_denials_total{reason=..., service=...}` counter
  - 增加 `nsn_acl_allows_total{service=...}` counter
  - `/api/acl` 的 `recent_denials` 仍保留供 UI 看具体内容
- **Cost vs Benefit**：~0.5 人日；高安全 ROI
- **Migration risk**：无

---

## OBS-009 · panic / spawn 失败 / task 提前退出无可观测信号

- **Severity**: P1（高）
- **Location**: 见 [FAIL-001](./failure-modes.md#fail-001) 和 [FAIL-010](./failure-modes.md#fail-010)
- **Current behavior**：
  - `tokio::spawn(async move { ... })` 散布全仓库（仅 nsn/main.rs 就 30+ 处），返回的 `JoinHandle` 大多被 `_` 丢弃或仅存到 Vec
  - panic 后 task 静默消失；`tokio::runtime::Builder::new_multi_thread()` 默认不主动报告 panic
  - 没有 `nsn_task_panics_total` / `nsn_task_terminated_total{name=...}` 计数
- **Why it's a defect**：
  - 任何关键 task（heartbeat / wg packet pump / acl reload / ws read loop）panic 后,系统进入"半瘫痪"状态而 `/api/healthz` 仍返回 200
  - liveness probe 无法识别这类故障
- **Impact**：
  - 生产长尾问题最难定位的一类
  - 容器编排（k8s）无法触发 restart，因为 PID 1 未死
- **Fix**：
  - 封装 `spawn_named(name, fut)`：`AssertUnwindSafe` + `catch_unwind` + 出错时 `nsn_task_panics_total{name}` + 记录 `error!`
  - 关键任务可选择 panic 后进程退出（让 systemd / k8s 重启）
  - `/api/healthz` 加上 "关键 task 仍存活" 校验,而不仅是 "process 还在跑"
- **Cost vs Benefit**：~2 人日；阻断一整类生产事故
- **Migration risk**：低；`spawn_named` 是 wrapper 改造

---

## OBS-010 · NSC 完全没有指标端点

- **Severity**: P2（中）
- **Location**: `crates/nsc/src/main.rs`；NSC 二进制不包含 `monitor.rs` 等 axum 路由
- **Current behavior**：NSC 不监听 `/api/metrics`/`/api/status`/`/api/healthz`,也没有 OTel pipeline 初始化（`grep -n "init_telemetry" crates/nsc/`：0 命中）
- **Why it's a defect**：
  - 用户端故障是支持工单第一来源,缺指标 = 无法远程 triage
  - 完全无法回答"DNS 是否被 NSC 接管"/"VIP 端口绑定成功率"/"上游 NSGW RTT" 等
- **Impact**：
  - 排查问题必须远程要 RUST_LOG=trace 日志
  - 不能做"群体性故障"识别（例如多用户同一类问题）
- **Fix**：
  - 在 NSC 引入 minimal `/metrics` 端点（监听本地 127.0.0.1 即可）
  - 暴露：dns_queries_total / vip_ports_active / nsgw_rtt / proxy_connections / ws_reconnects_total
- **Cost vs Benefit**：~1 人日；显著提升 NSC 故障可观测性
- **Migration risk**：无（新增端点）

---

## OBS-011 · 无 SLI/SLO 定义和文档

- **Severity**: P3（低）
- **Location**: 文档与代码均无；`docs/` 中无 SLO/SLI 章节
- **Current behavior**：仓库未声明任何 SLI（service level indicator）或 SLO（objective）
- **Why it's a defect**：
  - 工程团队对"什么算坏"无统一定义
  - 没有 "p99 数据面延迟 < 50ms" / "tunnel up time 99.9%" / "ACL 加载延迟 < 5s" 等基线
  - alerting 难以对齐业务影响
- **Impact**：报警噪音 vs 漏报全凭经验
- **Fix**：
  - 在 [`docs/01-overview/`](../01-overview/) 增加 SLI/SLO 章节
  - 至少定义 4 个 SLI：tunnel availability / data-plane p99 latency / control-plane RTT / ACL reload p99
  - 与 OBS-006 的 histogram 配套
- **Cost vs Benefit**：~1 人日（文档为主）；为运维体系奠基
- **Migration risk**：无

---

## OBS-012 · `tracing` 文件 appender 是 daily rolling,无大小上限/无压缩/无清理

- **Severity**: P3（低）
- **Location**: `crates/nsn/src/main.rs:243-251`
- **Current behavior**：
  ```rust
  let file_appender = rolling::daily(log_dir, "nsn.log");
  ```
  - daily 滚动 = 每天一个新文件
  - **无最大文件大小限制**（一天若日志爆量,可塞满磁盘）
  - **无保留天数**（旧文件无人清理）
  - **无压缩**（gzip）
- **Why it's a defect**：高负载场景或 RUST_LOG=debug 下，`/var/log/nsn-*.log` 可能撑爆容器卷
- **Impact**：
  - 长跑节点磁盘爆满 → 整机故障
  - 过期日志无法被 logrotate 接管（`rolling::daily` 自己生成名称）
- **Fix**：
  - 接入 `tracing-appender::rolling::Builder`（newer API）或自建按大小滚动
  - 设置保留窗口（如 7 天）+ 压缩
  - 或文档明确推荐由系统 logrotate 接管 stdout
- **Cost vs Benefit**：~0.5 人日；防止生产事故
- **Migration risk**：低

---

## 小结：可观测性"缺位"的等级地图

[可观测性缺陷优先级 · 四象限](./diagrams/obs-priority-matrix.d2)

---

## 与其他章节的交叉引用

| 本章 | 关联缺陷 | 关系 |
|------|---------|------|
| OBS-003 | [FAIL-005](./failure-modes.md#fail-005) | OBS-003 是 FAIL-005 的"可见化"前置 |
| OBS-004 | [FAIL-008](./failure-modes.md#fail-008) | 同源问题:channel 缺乏 metric → 无法触发预警 |
| OBS-009 | [FAIL-001](./failure-modes.md#fail-001), [FAIL-010](./failure-modes.md#fail-010) | spawn panic 不可见是 FAIL-001 的可观测性面 |
| OBS-006 | [PERF-001](./performance-concerns.md#perf-001), [PERF-002](./performance-concerns.md#perf-002) | 没有 histogram → 无法定量验证 perf 改造 |
| OBS-001 / OBS-007 | [ARCH-006](./architecture-issues.md#arch-006) | 入口冗长 + 多个写指标点缺乏统一抽象 |
| OBS-008 | [SEC-001](./security-concerns.md) | ACL deny 不可观测 → 安全事件无法早发现 |

---

## 推荐落地顺序

1. **第一波（1 周内）**：OBS-003 / OBS-008 / OBS-009 — 都是 < 1 人日且补的是当前最暗黑的盲区
2. **第二波（2 周内）**：OBS-001 + OBS-007 + OBS-002 一起做（统一指标管线改造），同步带 OBS-006（histogram）
3. **第三波（1 个月内）**：OBS-005（tracing span）+ OBS-010（NSC 指标端点）
4. **持续**：OBS-011（SLI/SLO 文档）+ OBS-012（日志清理）

具体的工单分解和成本汇总见 [improvements.md](./improvements.md) 和 [roadmap.md](./roadmap.md)。
