# NSN · 改造路线图

> 本页融合 [`docs/10/roadmap.md`](../10-nsn-nsc-critique/roadmap.md)(NSN/NSC 70+ 缺陷 → 7 主题 8 阶段)与 [`docs/11/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md)(NSD/NSGW 生产化 MVP→GA→企业级),只挑出**与 NSN 直接相关**的阶段、依赖与跨团队协调点。
>
> 起点锚定 2026-04-20。实际上线时间取决于团队规模与并行度。

## 1. 路线图总览

NSN 的改造路线由两条主线交织:

```
缺陷修复 (10/roadmap)              生产化扩展 (11/roadmap)
─────────────────────              ───────────────────────
Phase 0 · 紧急止血 (1 周)           MVP · 核心运行
Phase 1 · ACL/Policy 统一 (2-3 周)  ─┐
Phase 2 · 可观测性栈 (并行)         ─┤
Phase 3 · 数据面健壮性 (3-5 周)     ─┼─→ GA · 中型企业可卖
Phase 4 · 安全深化 (5-7 周)         ─┤
Phase 5 · 入口拆分与性能 (并行)     ─┤
Phase 6 · 半成品收尾 (贯穿)         ─┘
Phase 7 · 控制面长期改造            ─→ 企业级
```

完整 Gantt → [10 · diagrams/roadmap-gantt.d2](../10-nsn-nsc-critique/diagrams/roadmap-gantt.d2)
依赖关系 → [10 · diagrams/roadmap-dependencies.d2](../10-nsn-nsc-critique/diagrams/roadmap-dependencies.d2)

## 2. Phase 拆解

### Phase 0 · 紧急止血(第 1 周)

**目标**:72 小时内消除 2 个 P0 安全洞 + 1 个 P0 OOM 风险。

| Workstream | NSN 改动 | 关闭缺陷 |
| --- | --- | --- |
| ACL fail-closed | `nat::ServiceRouter::resolve*` 三处改 fail-closed | [SEC-001](./bugs.md#7-安全问题-sec--15-条) |
| 强制 https | `to_http_base()` → https + reqwest TLS 校验 | [SEC-002](./bugs.md#7-安全问题-sec--15-条) |
| 启动等 ACL | 启动序列等 ACL 加载完成,配置 `startup.acl_required = true` | [SEC-008](./bugs.md#7-安全问题-sec--15-条) |
| spawn_named | 封装 `spawn_named`,关键 task 替换;新增 `nsn_task_panics_total` | [OBS-009](./bugs.md#5-可观测性-obs--12-条) / [FAIL-001](./bugs.md#4-故障模式-fail--11-条全部影响-nsn) |
| conntrack GC | `ConntrackTable` 加 TTL/cap/cleanup task | [FUNC-005](./bugs.md#func-005) |

**准入条件**:
- 4 套 Docker E2E 全绿 + 新增 fail-closed E2E
- 性能回归 < 5%

**完成后状态**:启动期不再 fail-open;Token 不再走明文 HTTP;NAT 表不会无限增长;spawn task panic 可观测。

### Phase 1 · ACL/Policy 统一(第 2-3 周)

**目标**:消除 ACL 双 Arc / 双语义,多 NSD 合并不再有空 ACL 雪崩,NSC 进入 ACL 体系。

**NSN 改动**:
- `AppState` 增加 `acl: ArcSwap<Option<AclEngine>>`;删 `nat::ServiceRouter::acl_engine` 与 `connector::ConnectorManager::acl` 两份独立 Arc
- `AclConfig::Empty` ≠ `AclConfig::DenyAll`;merge 时空配置不参与交集
- 新增 metric:`nsn_acl_load_state`、`nsn_acl_denials_total`、`nsn_acl_allows_total`、`nsn_acl_merge_sources`、`nsn_acl_merge_empty_skipped_total`

**前置依赖**:Phase 0 SEC-001 必须完成

**准入条件**:
- 并发读路径下 ACL 切换不 lost-update
- 3 个 NSD 中 1 个推空 ACL 不影响其他两个
- NSC 也走 ACL 路径

### Phase 2 · 可观测性栈(第 2-4 周,与 Phase 1 并行)

**目标**:所有指标统一从 OTel meter 暴露;关键路径有 histogram;spawn task 安全;NSC 也有 /metrics。

**NSN 改动**:
- `monitor.rs:344-375` 手写 `format!()` 全部改为 OTel instrument
- 关键路径增加 histogram(WSS Open / ACL is_allowed / ServiceRouter::resolve / SSE dispatch / wg encrypt-decrypt)
- 封装 `MeteredSender<T>`,所有 mpsc 用它包裹;暴露 `nsn_channel_pending` / `nsn_channel_dropped_total`
- 入口 task 创建 root span,绑定 `gateway_id` / `connection_id` / `frame_seq`
- 文档增加 SLI/SLO 章节(4 个核心 SLI)
- 日志 file appender 改为按大小+保留窗口滚动

**准入条件**:
- `/api/metrics` 不再含 `format!()` 拼接
- 关键路径有至少 5 个 histogram
- NSC 暴露 `/metrics` 至少 8 个 metric

### Phase 3 · 数据面健壮性(第 3-5 周)

**目标**:WSS 通道断后能快速收敛、NSGW 健康真实探活、单 TCP HOL 缓解。

**NSN 改动**:
- `MultiGatewayManager::health_interval` 启用 30s 健康探活;Failed gateway 进入指数退避重连
- WSS upgrade 不再 abort 旧 stream;先 draining,完成 in-flight 后再切
- 单 WSS TCP 改为 N 路 TCP(N=cpus 或可配);streams 哈希分散
- relay_* 任务增加 idle timeout(默认 5 min)
- `proxy_done` channel 容量 1 → 4

**前置依赖**:D.4(多 TCP)依赖 Phase 2 metric 框架做 benchmark

**准入条件**:
- 杀掉一条 NSGW TCP 后 30 秒内重连成功率 > 99%
- ConntrackTable evict 行为可在 metric 上看到
- 双 TCP 比单 TCP throughput 提升至少 30%

### Phase 4 · 安全深化(第 5-7 周)

**目标**:闭合 SEC-003 / SEC-004 / SEC-013 / SEC-015 等 P1;引入 audit log;密钥不再明文。

**NSN 改动**:
- 私钥 AEAD 包裹(chacha20poly1305),密钥来自 `NSN_KEY_ENC_KEY` 或 OS keyring
- `secrecy::SecretString` 包裹 token;tracing field 强制脱敏
- auth 改 challenge-response,签名嵌入 `nsd_url` + server nonce
- 新建 `crates/audit/`,`SecurityEvent` enum + 独立 syslog/file sink

**前置依赖**:B.4 密钥来源决策;B.3 challenge-response 需 NSD 端配套

### Phase 5 · 入口拆分与性能(第 5-8 周,与 Phase 4 并行)

**NSN 改动**:
- `nsn/src/main.rs:300-1100` 按功能拆 `startup_acl.rs` / `startup_wg.rs` / `startup_proxy.rs` / `startup_monitor.rs`,统一 `AppBuilder` 模式
- 删 `proxy::handle_tcp_connection` 或把 nsn/main.rs 的 TCP relay 替换为 proxy crate
- 启动后增加 cross-config 一致性校验(services 引用的 wg 隧道在 WgConfig 中存在)
- 性能:WSS data 帧用 `bytes::Bytes` 零拷贝;services hostname DNS cache(TTL 30s);READ_BUF 调到 16384

**准入条件**:
- `nsn/src/main.rs` ≤ 400 行
- 子模块各自有 unit test
- 性能 metric 有 before/after 对比报告

### Phase 6 · 半成品收尾(贯穿)

| Item | NSN 影响 | 时机 |
| --- | --- | --- |
| 删 `acl_ip_adapter` | 无(已是 dead code) | Phase 0 顺手 |
| `services_ack` 写入 AppState | 增 `/api/services` 字段 | Phase 0 顺手 |
| NSC `--device-flow/status` | NSC-only,不影响 NSN | Phase 1 期间 |
| NSC `_token_rx` 接管 | NSC-only | 与 A.6 一起 |
| NSC TUN 决策与实现 | NSC-only | Phase 3 之后 |

### Phase 7 · 控制面长期改造

- B.2:把 `register/auth/heartbeat` 真正纳入 ControlTransport(NSD 端配套)
- F.2:合并双 TCP relay
- F.3:cross-config 校验

## 3. 跨团队协调点

某些改造**必须协调 NSD/NSGW 端**:

| 改造 | NSN 改动 | NSD/NSGW 配套 | 协调点 |
| --- | --- | --- | --- |
| 强制 https | reqwest scheme | NSD 必须开 8443/https | 部署文档同步发布 |
| 加密通道承载 HTTP API | ControlTransport 扩展 | NSD 实现 transport 适配器 | 跨团队 spec 评审 |
| challenge-response | 增加 challenge POST | NSD `/api/v1/machine/auth/challenge` | API 版本协商 |
| 多 TCP WSS | 多通道 frame 协议 | NSGW 识别多通道协商 | WS frame v2 spec |
| frame source identity | 新增 source 字段 | NSGW 填入 NSC 身份 | frame schema bump |
| ACL sentinel | merge 算法 | NSD 标记"empty 是真实意图"vs"空因失败" | API 行为约定 |

## 4. 风险与回滚预案

| 高风险改造 | 风险 | 回滚预案 |
| --- | --- | --- |
| 单一 ACL Arc | 并发竞态难调试 | feature flag `acl.use_arcswap = false` 保留旧路径 |
| fail-closed | 启动时延变长,旧部署可能告警 | 配置 `acl_required = false` 临时关闭 |
| 强制 https | NSD 端未开 https → register 失败 | `auth.allow_plaintext_for_legacy = true` 过渡期 |
| 密钥加密 | 升级时旧明文密钥被误删 | 永远 read 兼容 + write 加密;`machinekey.legacy.json` 备份 |
| 多 TCP WSS | NSGW 不识别 → 所有 WSS 失败 | frame v2 协商失败回退 v1 |
| main.rs 拆分 | 大重构容易引入回归 | 每次 PR < 200 行;失败立刻 revert |

## 5. 监控与回顾

每个 Phase 结束必须:

1. 4 套 Docker E2E + 新增 E2E 全绿
2. 与 Phase 之前 perf snapshot 对比(吞吐 / p99 / OOM)
3. 用 [security-concerns.md](../10-nsn-nsc-critique/security-concerns.md) 清单逐项验证
4. 受影响 docs 由 owner 更新;本目录(nsn/)与 10/ 11/ 保持一致
5. 在 [bugs.md](./bugs.md) 与 [improvements.md §2](../10-nsn-nsc-critique/improvements.md#2-缺陷--主题反向索引) 勾掉已关闭缺陷

## 6. Phase 0 紧急行动清单(24 小时内)

如果只能做一件事:

1. **冷启动 → 把 SEC-001 fail-closed 合并**(~1 人日)
2. 同步把 [bugs.md §1 P0 必修](./bugs.md#1-p0-必修8-项)发给安全 / 运维 owner

如果有 1 周:完成 Phase 0 全部 5 项。
如果有 1 月:Phase 0 + Phase 1 + Phase 2 关键改造。
如果有 1 季度:Phase 0~4 全部 P0/P1。
如果有 1 年:全部 Theme A~G。

## 7. NSN 在生产化 MVP/GA/企业级 的角色演进

来自 [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) 与 [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md):

| 阶段 | NSN 形态 | 必要补齐 |
| --- | --- | --- |
| **MVP** | 数据中心 NSN,单数据面(WG/UserSpace) | Phase 0~3 完成;基本 OTel + SLI/SLO |
| **GA** | + 多区域 / 多 NSGW failover + WSS 多 TCP + 移动端基础(动态 keepalive) | Phase 4 完成;P2P 基础 hole punch |
| **企业级** | + edge NSN(无头 provisioning)+ 跨云 + BYO-CA + FEC + 硬件加速 | Phase 5~7 完成;策略 DSL / 仿真 / 审批落地 |

详见 → [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md)

---

完整路线图原文:

- [10 · roadmap.md](../10-nsn-nsc-critique/roadmap.md) · NSN/NSC 8 阶段排期
- [10 · improvements.md](../10-nsn-nsc-critique/improvements.md) · 7 主题 fix proposal + 缺陷反向索引
- [11 · roadmap.md](../11-nsd-nsgw-vision/roadmap.md) · NSD/NSGW MVP→GA→企业级
- [11 · operational-model.md](../11-nsd-nsgw-vision/operational-model.md) · 生产部署形态 + SLA
