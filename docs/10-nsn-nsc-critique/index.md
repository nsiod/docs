# NSN + NSC 架构审查报告

> **角色**：独立审查员，对当前 NSN（站点节点）+ NSC（用户客户端）架构做"挑刺"。
> **不是**：另一份设计文档、另一份用户手册、另一份对仓库的赞美。
> **是**：基于 HEAD 源码（2026-04-16，18,037 行 Rust，12 crates）的**缺陷清单 + 改进提议**。
> **范围**：仅评 NSN/NSC 实现；NSGW/NSD 设计参见 [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/)。

---

## 0. 一图速览

[输入材料 / 产出章节 / 改造建议 / 可视化 全景](./diagrams/index-inputs-outputs.d2)

---

## 1. TL;DR · 5 分钟读完

### 关键判断

1. **代码质量基本面良好**：`#[forbid(unsafe_code)]` 全覆盖，单元测试 ~300 个，4 套 Docker E2E。
2. **真正的问题是架构层语义不一致 + 安全失守**，不是单点 bug：
   - **ACL 引擎**有两份独立 Arc，对"未加载"采取**相反**的 fail 语义（WSS fail-CLOSED；本地路由 fail-OPEN）— 见 [SEC-001](./security-concerns.md#sec-001) / [ARCH-001](./architecture-issues.md#arch-001)
   - **`to_http_base()`** 把 `noise://` / `quic://` 静默改写为 `http://`（不是 https）— 凭据明文 — 见 [SEC-002](./security-concerns.md#sec-002)
   - **多 NSD 合并用交集**，任一 NSD 推空 ACL 即清空全局策略 `[RESOLVED — 决议改并集 + 本地 ACL 保底]` — 见 [ARCH-002](./architecture-issues.md#arch-002) / [SEC-005](./security-concerns.md#sec-005) / [FAIL-006](./failure-modes.md#fail-006)
   - **ConntrackTable 无 GC/TTL/cap** — P0 OOM 风险 — 见 [FUNC-005](./functional-gaps.md#func-005)
   - **NSC 完全无 outbound ACL**、`--data-plane tun` 是假 TUN（仅改 VIP 前缀）、token 刷新通道被丢弃 — 见 [FUNC-001](./functional-gaps.md#func-001) / [FUNC-004](./functional-gaps.md#func-004) / [SEC-006](./security-concerns.md#sec-006)
3. **可观测性严重缺位**：注册了 OTel pipeline 但**没有任何 instrument**；`/api/metrics` 由 7 行 `format!()` 拼接产生；无 histogram、无 span、无 trace_id、spawn task panic 不可见 — 见 [observability-gaps.md](./observability-gaps.md)
4. **半成品散布**：`AclFilteredSend`、`MultiGatewayManager::health_interval`、`nsc::status`、`nsc --device-flow` 等 6 处 dead/TODO 代码 — 见 [current-state.md §8](./current-state.md#8-半成品--dead_code-一览)

### 一句话评语

> NSN 的核心数据/控制管线设计**结构合理**，但**安全裁决层缺乏一致性**、**可观测性几乎空白**、**多 NSD 合并语义脆弱**；NSC 是一个**交付承诺过早**的客户端（多个 CLI 选项不工作）。70+ 缺陷收敛为 **7 个主题改造**（约 ~69 人日）即可消除 8 个 P0 + 13 个 P1。

### Top 5 必修（P0）

| ID | 一句话 | 为什么 P0 |
|----|--------|----------|
| [SEC-001](./security-concerns.md#sec-001) | ACL 引擎双 Arc + fail 语义不对称（WSS 闭、本地开） | 启动窗口/重连窗口直接绕过策略 |
| [SEC-002](./security-concerns.md#sec-002) | `to_http_base` 把 noise:// / quic:// 改写为 **http://**（非 https） | register/auth/heartbeat 凭据明文 |
| [SEC-005](./security-concerns.md#sec-005) `[RESOLVED]` | 任一 NSD 推空 ACL → 交集合并清空全局策略 | 单点导致全局 ACL 失效 — 已决议改并集 + 本地 ACL 保底 |
| [SEC-008](./security-concerns.md#sec-008) | ACL 加载 10s 超时后继续启动（fail-open 启动窗口） | 每次重启的安全空窗 |
| [FUNC-005](./functional-gaps.md#func-005) | `ConntrackTable` 无 GC/TTL/cap | 长跑 OOM；攻击放大 |

---

## 2. 文档导航

### 阅读路径

| 你想 ... | 读什么（按顺序） |
|---------|-----------------|
| 快速了解整体判断 | 本 README → [current-state.md](./current-state.md) |
| 理解评分依据 | [methodology.md](./methodology.md) |
| 找架构层问题 | [architecture-issues.md](./architecture-issues.md) |
| 找半成品 / TODO 实现 | [functional-gaps.md](./functional-gaps.md) |
| 看故障模式与误差链 | [failure-modes.md](./failure-modes.md) |
| 找性能瓶颈 | [performance-concerns.md](./performance-concerns.md) |
| 找可观测性差距 | [observability-gaps.md](./observability-gaps.md) |
| 找安全问题 | [security-concerns.md](./security-concerns.md) |
| 找具体改造方案 | [improvements.md](./improvements.md) |
| 看落地排期 | [roadmap.md](./roadmap.md) |

### 文件清单

| 文件 | 内容 | 大致行数 | 缺陷数 |
|------|------|---------|--------|
| `index.md` | 本文，索引 + 阅读路径 + TL;DR | 200+ | — |
| `methodology.md` | 评分口径 + 9-字段缺陷格式 + ID 命名 | 250+ | — |
| `current-state.md` | HEAD 状态速览（二进制/数据面/控制面/ACL/多 NSD/mpsc/可观测/dead_code） | 150+ | — |
| `architecture-issues.md` | 10 条 ARCH-* 缺陷 | 600+ | 10 |
| `functional-gaps.md` | 12 条 FUNC-* 缺陷 | 600+ | 12 |
| `failure-modes.md` | 11 条 FAIL-* 缺陷 + 故障级联图 | 600+ | 11 |
| `performance-concerns.md` | 10 条 PERF-* 缺陷 + 热路径分析 | 500+ | 10 |
| `observability-gaps.md` | 12 条 OBS-* 缺陷 + metric/tracing/log 现状 | 500+ | 12 |
| `security-concerns.md` | 15 条 SEC-* 缺陷 + 信任边界图 | 700+ | 15 |
| `improvements.md` | 7 主题级 fix proposals + 缺陷反向索引 | 600+ | — |
| `roadmap.md` | 分 8 阶段排期 + 跨团队协调点 + 回滚预案 | 500+ | — |
| `diagrams/issue-heatmap.d2` | 缺陷热度图（模块 × 严重度） | — | — |
| `diagrams/coupling-graph.d2` | 当前耦合 vs 改进后解耦 | — | — |
| `diagrams/failure-cascade.d2` | 典型故障级联路径 | — | — |
| `diagrams/roadmap-phases.d2` | 改造路线 Gantt | — | — |

**总计**：70 条缺陷 / ~5000 行文档 / 4 张独立 d2 图

---

## 3. 评审范围与原则

### 原则

1. **挑刺，不替代**：本目录是**审查报告**，不重写设计、不修改 `docs/01-09` 与 `docs/11`、不动 `web/` 与 `PLAN.md`
2. **结构性 vs 半成品**：方法论第 §3 节明确二者区分；后者只是"还没写完"，前者是"写完了也不对"
3. **每条缺陷 9 字段**：ID / Severity / Location（精确到 `crates/<x>/src/<f>.rs:<line>`）/ Current / Why-defect / Impact / Fix / Cost-Benefit / Migration-risk
4. **不写 emoji，不写心灵鸡汤**：符合用户的 CLAUDE.md 要求
5. **每个 .md 至少一张 d2 图**：方便 review

### 范围边界

| 在范围内 | 不在范围内 |
|---------|----------|
| `crates/{nsn,nsc}/**` | NSD/NSGW 实现（非本仓库） |
| `crates/{control,connector,nat,proxy,acl,tunnel-*,netstack,common,telemetry}/**` | 上游依赖（gotatun, smoltcp, snow, quinn）的内部缺陷 |
| `tests/` 中的 4 套 Docker E2E（仅引用，不深审） | UI / web 层 |
| `docs/01-09` 与本审查的事实关系 | 修改 `docs/01-09` |

### 评审依据

- **HEAD**：2026-04-16 当时的 main / 默认分支
- **代码统计**：18,037 行 Rust，12 crates，2 二进制（`nsn`/`nsc`）
- **参考文档**：`docs/01-overview/` 至 `docs/09-nsgw-gateway/` 的 README
- **跨产品对照**：tailscale / headscale / zerotier / nebula 的公开行为（仅作判断锚点，不抄设计）

---

## 4. 缺陷分布速览

### 按严重度

[70 条缺陷按严重度分布](./diagrams/defect-by-severity.d2)

### 按章节

[70 条缺陷按章节分布](./diagrams/defect-by-section.d2)

### 按受影响 crate

| crate | P0 | P1 | P2/P3 | 主要问题 |
|-------|----|----|----|---------|
| `nsn` | 2 | 4 | 8 | main.rs 装配臃肿 + 启动 fail-open 窗口 |
| `nsc` | 1 | 5 | 4 | 多个 CLI 半成品 + 无 ACL |
| `control` | 2 | 3 | 6 | HTTP API 旁路 transport + auth 重放窗口 + 多 NSD 合并 |
| `tunnel-ws` | 0 | 3 | 5 | 单 TCP HOL + frame 缺 source + WSS upgrade 不安全 |
| `tunnel-wg` | 0 | 0 | 3 | AclFilteredSend 死代码 |
| `nat` | 1 | 2 | 4 | conntrack 无 GC + ServiceRouter fail-open |
| `connector` | 1 | 2 | 4 | health_interval 死代码 + proxy_done 容量 1 |
| `acl` | 0 | 1 | 2 | 无 metric / 评估时序 |
| `telemetry` | 0 | 0 | 3 | OTel 空跑 + 重复 struct |
| `common` | 0 | 1 | 1 | 私钥明文落盘 |
| `proxy` | 0 | 0 | 2 | 生产未使用 |
| `netstack` | 0 | 0 | 1 | smoltcp 调参未做 |

---

## 5. 与 `docs/01-09` 的关系

| docs 章节 | 本审查相关入口 |
|----------|--------------|
| [01-overview](../01-overview/) | `current-state.md` 是其"挑刺版" |
| [02-control-plane](../02-control-plane/) | ARCH-008 / SEC-002 / SEC-003 / SEC-005 |
| [03-data-plane](../03-data-plane/) | ARCH-009 / FAIL-003 / FAIL-004 / PERF-002/003 |
| [04-network-stack](../04-network-stack/) | FUNC-005 / FUNC-006 / FAIL-005 |
| [05-proxy-acl](../05-proxy-acl/) | ARCH-001 / SEC-001 / SEC-005 / OBS-008 |
| [06-nsc-client](../06-nsc-client/) | FUNC-001 ~ FUNC-004 / SEC-006 / SEC-010 |
| [07-nsn-node](../07-nsn-node/) | ARCH-006 / FAIL-001 / FAIL-002 |
| [08-nsd-control](../08-nsd-control/) | 仅作上游契约引用，不审 |
| [09-nsgw-gateway](../09-nsgw-gateway/) | ARCH-009 的对端，不审实现 |
| [11-nsd-nsgw-vision](../11-nsd-nsgw-vision/) | 不引用、不影响 |

**docs/01-09 不会被本审查修改**。任何"docs 描述与代码不符"的发现仅作为 ARCH-* / FUNC-* 缺陷的旁证记录，由各 docs owner 决定是否更新。

---

## 6. 后续动作

1. **审查使用方**：按 [roadmap.md §7 紧急行动清单](./roadmap.md#7-phase-0-紧急行动清单24-小时内)分级处置
2. **决策点回顾**：`improvements.md §6 决策清单` 中的 6 个产品/架构问题需要技术 lead 给出方向
3. **本目录文档**：作为审查"快照"长期保留；后续修复完成后**不删除**对应缺陷条目，只在 status 字段加 `RESOLVED in commit <hash>`
4. **新发现缺陷**：按 [methodology.md §4](./methodology.md#4-缺陷记录格式强制) 9-字段格式追加到对应章节末尾，ID 顺延

---

## 7. 致读者

- 这份报告对当前实现有**显著的批评**。批评是工程协作的常态，不针对作者；所有 P0/P1 都给出了具体 fix 路径
- 本报告**不是 PR**。任何具体修复都需要走团队既有流程
- 如对某条缺陷有异议（"line 号已变"/"语义已不同"/"修复已合入"），请直接在本目录发起 PR 修订该条目；不要修改 `docs/01-09`
