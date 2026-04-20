# NSC · 改造路线图

> 本页从 [`docs/10/roadmap.md`](../10-nsn-nsc-critique/roadmap.md)(NSN/NSC 70+ 缺陷 → 7 主题 8 阶段)与 [`docs/11/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md)(NSD/NSGW 生产化 MVP→GA→企业级)中抽出**与 NSC 直接相关**的阶段、依赖与跨团队协调点。
>
> 起点锚定 2026-04-20。实际上线时间取决于团队规模与并行度。

## 1. 路线图总览

NSC 改造与 NSN 共享大框架,但很多 workstream 是 NSC-only(TUN 决策、device-flow、client 端 ACL、本地 `/metrics`)。

```
NSN/NSC 共享主线 (10/roadmap)        NSC-only 补丁 (E.*)
─────────────────────────            ─────────────────────
Phase 0 · 紧急止血 (1 周)             E.5 services_ack(顺手)
Phase 1 · ACL/Policy 统一 (2-3 周)    E.3 NSC `_token_rx` 接管
                                      A.6 NSC 出站 ACL 试点
Phase 2 · 可观测性栈 (并行)           C.8 NSC `/metrics` 端点
                                      E.2 NSC --device-flow / status
Phase 3 · 数据面健壮性 (3-5 周)       (跟随 NSN,WSS 多 TCP 共享)
Phase 4 · 安全深化 (5-7 周)           (token 加密落盘)
Phase 5 · 入口拆分与性能 (并行)       (NSC main.rs 相对小,优先级低)
Phase 6 · 半成品收尾 (贯穿)          E.1 TUN 决策与实现
Phase 7 · 控制面长期改造              —
```

完整 Gantt → [10 · diagrams/roadmap-gantt.d2](../10-nsn-nsc-critique/diagrams/roadmap-gantt.d2)
依赖关系 → [10 · diagrams/roadmap-dependencies.d2](../10-nsn-nsc-critique/diagrams/roadmap-dependencies.d2)

## 2. Phase 拆解

### Phase 0 · 紧急止血(第 1 周)

**目标**:NSC 不再悄悄丢 token 刷新、CLI 不再声称支持并未实现的能力。

| Workstream | NSC 改动 | 关闭缺陷 |
| --- | --- | --- |
| 诚实的 CLI | `--device-flow` / `--data-plane tun` 保留但启动期打印 WARN,或加 `unstable` 门闩 | [FUNC-001 / FUNC-012](./bugs.md#1-p0p1-必修) |
| Token 生命周期诊断日志 | `main.rs` SSE select 分支加 `warn!` 日志记录丢弃 token 事件计数 | [FUNC-002](./bugs.md#func-002-_token_rx-被丢弃) |
| status CLI 占位 → 明确退出码 | `nsc status` 至少返回 "not implemented, planned in Phase 2" | [FUNC-012](./bugs.md#func-012-nsc-status-和-devices-占位) |

**准入条件**:
- CLI 不再对用户说谎(`--help` 提示能力并实际不支持)
- 4 套 Docker E2E 全绿

**完成后状态**:NSC 的"虚假承诺"收敛为显式警告;下一阶段有真实的接管入口。

### Phase 1 · NSC 出站 ACL + Token 接管(第 2-3 周,与 NSN Phase 1 并行)

**目标**:NSC 不再完全依赖 NSN/NSGW 兜底 ACL;token 刷新真正生效。

**NSC 改动**(workstream A.6 + E.3):
- 复用 `ControlPlane::new` 的 `_acl_rx` 与 `_token_rx`,不再以 `_` 前缀丢弃
- `AppState` 新增 `outbound_acl: ArcSwap<Option<AclEngine>>`
- `proxy.rs::open_stream` 打开 WSS 之前做客户端 ACL 预检(快速 deny 即本地 RST,不占用 NSGW)
- `auth.rs::MachineState` 支持 token 轮转;轮转后更新 `registrations/<realm>.json`
- 新增 metric:`nsc_acl_denials_total`、`nsc_token_rotations_total`

**前置依赖**:Phase 0 CLI 诚实化完成;NSN Phase 1 的 ACL 语义约定 (A.4 `Empty ≠ DenyAll`) 必须先落地

**准入条件**:
- 单元测试:ACL 切换在并发读路径下不 lost-update
- E2E:NSC 端预检命中后 NSGW 上看不到对应 CMD_OPEN_V4 frame
- token 轮转后旧连接优雅 draining,新连接用新 token

### Phase 2 · NSC 可观测性(第 2-4 周,与 NSN Phase 2 并行)

**目标**:NSC 暴露 `/metrics` 端点;关键路径有 histogram;`nsc status` 给出真实快照。

**NSC 改动**(workstream C.8 + E.2 的 `--status`):
- `main.rs` 新增 `--metrics-bind 127.0.0.1:9091`(默认关闭,opt-in)
- 至少 8 个 metric:
  - `nsc_dns_queries_total{type,result}`
  - `nsc_dns_upstream_latency_seconds`
  - `nsc_vip_allocations_total{site}`
  - `nsc_vip_allocator_reject_total`
  - `nsc_nsgw_rtt_seconds`
  - `nsc_ws_reconnects_total{gateway}`
  - `nsc_tunnel_bytes_total{direction}`
  - `nsc_acl_denials_total`(Phase 1 引入)
- `nsc status` 通过 UNIX socket / HTTP 返回 sites / vips / dns / tunnel 状态
- 关键路径 histogram:DNS query / open_stream / WSS upgrade

**准入条件**:
- `/metrics` 文本与 Prom exposition 格式一致
- `nsc status` 返回 JSON,且 e2e 跑起来有值
- 所有 metric 命名遵循 [SLI/SLO 约定](../10-nsn-nsc-critique/observability-gaps.md)

### Phase 3 · 数据面健壮性(第 3-5 周)

**目标**:NSC 沾光 NSN 的 WSS 多 TCP / 重连退避,减少 HOL 阻塞与长连接漂移。

**NSC 改动**(跟随 NSN workstream D.2 / D.4):
- `tunnel-ws` crate 升级后 NSC 自动获得多 TCP 协商能力
- `NscRouter` 长连接 lazy binding 加 idle timeout(默认 5 分钟)
- WSS upgrade 切换期间不再 abort 旧 stream;先 draining

**前置依赖**:NSN Phase 3 frame v2 协商落地(共享 crate)

**准入条件**:
- 杀掉一条 NSC ↔ NSGW TCP 后 30 秒内重连成功率 > 99%
- 双 TCP 比单 TCP throughput 提升至少 30%(用 Phase 2 metric 做 before/after)

### Phase 4 · 安全深化(第 5-7 周)

**目标**:token 不再明文落盘;register 签名绑 challenge。

**NSC 改动**(跟随 NSN workstream B.3 / B.4):
- `MachineState::save` token 用 AEAD 包裹,密钥来自 `NSC_KEY_ENC_KEY` 或 OS keyring
- `auth::register` 改 challenge-response,签名嵌入 `nsd_url` + server nonce
- `secrecy::SecretString` 包裹 token;tracing field 强制脱敏

**前置依赖**:NSN B.4 密钥来源决策;NSD 端 `/api/v1/machine/auth/challenge` 端点

### Phase 5 · 入口与性能(优先级最低)

**目标**:NSC `main.rs` 拆分与零拷贝性能。

**NSC 现状**:`crates/nsc/src/main.rs` ≈ 300 行,远小于 NSN main.rs,拆分优先级低;但可以抽出 `startup.rs` 把 CLI → AppState 装配逻辑从 `run()` 里拉出来。

**准入条件**:
- `crates/nsc/src/main.rs` ≤ 200 行,`run()` 只负责 orchestration
- WSS data 帧用 `bytes::Bytes` 零拷贝(NSN 先落,NSC 跟随)

### Phase 6 · 半成品收尾(贯穿)

| Item | NSC 影响 | 时机 |
| --- | --- | --- |
| E.5 `services_ack` 写入 AppState | 无(NSN 端) | Phase 0 顺手 |
| E.2 NSC `--device-flow` 实现 | 复用 `device_flow` crate;重跑 OAuth device flow | Phase 1 期间 |
| E.3 NSC `_token_rx` 接管 | 与 A.6 合并 PR | Phase 1 |
| E.1 NSC TUN 决策与实现 | **或**删除 `--data-plane tun`(若不做),**或**落地真 TUN | Phase 3 之后 |
| E.1b `--data-plane wss` 与 userspace 合并 | 两者语义等价,保留一个别名 | E.1 一起 |

**E.1 关键决策**(2026-05 技术决策会议):

- **选项 A · 删除 `tun` 模式**:用户靠 userspace/proxy 即可,TUN 不再是目标;CLI 标为 removed。
- **选项 B · 落地真 TUN**:调用 `tun-rs` 打开 TUN 设备;NscRouter 切换为 TUN+packet 模式;需要 root / CAP_NET_ADMIN,限 Linux / macOS。
- **选项 C · 推迟 + 文档明示**:保留骨架但启动打 `unstable` WARN,文档上清楚标记"仅换前缀"。

默认选项 C(Phase 0 已落);A/B 在 Phase 3 完成后复评。

### Phase 7 · 控制面长期改造

- B.2:NSC 的 `register/auth` HTTP API 真正纳入 ControlTransport(NSD 端配套)
- NSC 的 `gateway_config` 消费补齐:目前只用 primary gateway,未来接 multi-gateway failover
- 企业域 `split-DNS` 支持(非 `.n.ns` 域名规则)

## 3. 跨团队协调点

| 改造 | NSC 改动 | NSD/NSGW 配套 | 协调点 |
| --- | --- | --- | --- |
| 强制 https | reqwest scheme | NSD 必须开 8443/https | 部署文档同步发布 |
| challenge-response | 增加 challenge POST | NSD `/api/v1/machine/auth/challenge` | API 版本协商 |
| 多 TCP WSS | 多通道 frame 协议 | NSGW 识别多通道协商 | WS frame v2 spec |
| frame source identity | 新增 source 字段 | NSGW 填入 NSC 身份,NSN 透传 | frame schema bump |
| ACL sentinel | merge 算法 | NSD 标记"empty 是真实意图" | API 行为约定 |
| `device_code_url` / poll interval | 订阅 NSD device-flow API | NSD 暴露 device authorization endpoint | OAuth 2.0 device flow RFC 8628 |

## 4. 风险与回滚预案

| 高风险改造 | 风险 | 回滚预案 |
| --- | --- | --- |
| NSC 出站 ACL 预检 | 预检 bug 导致所有连接被本地 RST | feature flag `acl.client_side_enforce = false` |
| Token 加密落盘 | 升级时旧明文 token 被误丢 | 永远 read 兼容 + write 加密;保留 `registrations/<realm>.json.legacy` |
| E.1 选项 B(真 TUN) | 无 root / 无 CAP_NET_ADMIN 则启动失败 | 启动时先检查,失败回落 userspace + 打 WARN |
| 多 TCP WSS | NSGW 不识别 → 所有 WSS 失败 | frame v2 协商失败回退 v1 |

## 5. 不在路线图内的事项(延后 / 放弃)

| 事项 | 理由 |
| --- | --- |
| IPv6 / AAAA 命中 | 单独 milestone,跟 NSN IPv6 同步启动 |
| 移动端(iOS / Android)SDK | 超出 NSC CLI 本体范围,参考 [vision.md §6 移动端形态](./vision.md#6-移动端--edge-部署) |
| P2P 直连(hole punching) | 需要 NSGW 端 STUN/TURN 配套,排在企业级 GA 之后 |
| NSC 的 systray / GUI 包装 | 产品化任务,不进入核心 roadmap |
| 把 NSC 改造成 userspace WireGuard | boringtun 依赖成本高,当前 WSS relay 已够用 |

## 6. 监控与回顾

每个 Phase 结束必须:

1. 4 套 Docker E2E + 新增 NSC 专项 E2E 全绿
2. 与 Phase 之前 perf snapshot 对比(吞吐 / p99 / OOM)
3. 用 [bugs.md P0/P1](./bugs.md#1-p0p1-必修) 清单逐项验证
4. 本门户(nsc/)与 10/ 11/ 保持一致
5. 在 [bugs.md](./bugs.md) 已关闭缺陷处加 `[RESOLVED in <hash>]`

## 7. Phase 0 紧急行动清单(24 小时内)

如果只能做一件事:

1. **`--device-flow` / `--data-plane tun` 启动 WARN**(~半人日):CLI 不再对用户说谎
2. 同步把 [bugs.md §1 P0/P1 必修](./bugs.md#1-p0p1-必修) 发给 NSC 客户端 owner

如果有 1 周:完成 Phase 0 全部 3 项 + E.5。
如果有 1 月:Phase 0 + Phase 1(ACL + token 接管)+ Phase 2 关键 metric。
如果有 1 季度:Phase 0~4 全部 P0/P1。
如果有 1 年:包含 E.1 TUN 决策与 Phase 7。

## 8. NSC 在生产化 MVP/GA/企业级 的角色演进

来自 [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) 与 [vision.md](./vision.md):

| 阶段 | NSC 形态 | 必要补齐 |
| --- | --- | --- |
| **MVP** | 开发者 CLI(桌面 / CI),单 NSGW,userspace 数据面 | Phase 0~2 完成;真实的 token 刷新 + 基本 `/metrics` |
| **GA** | + 出站 ACL + 多 NSGW failover + WSS 多 TCP + HTTP 代理增强(SOCKS5 / PAC) | Phase 3~4 完成;mobile SDK α |
| **企业级** | + 真 TUN 模式 + P2P 直连 + split-DNS + posture report + systray GUI | Phase 5~7 完成;E.1 选项 B 落地 |

详见 → [vision.md §2 三种部署形态](./vision.md#2-三种部署形态-by-target-audience)

---

完整路线图原文:

- [10 · roadmap.md](../10-nsn-nsc-critique/roadmap.md) · NSN/NSC 8 阶段排期
- [10 · improvements.md](../10-nsn-nsc-critique/improvements.md) · 7 主题 fix proposal + 缺陷反向索引
- [11 · roadmap.md](../11-nsd-nsgw-vision/roadmap.md) · NSD/NSGW MVP→GA→企业级
- [NSN 路线图](../nsn/roadmap.md) · 对称视角
