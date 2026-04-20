# NSD · 已知缺陷与改进项

> 本页汇总与 NSD **相关**的缺陷项,分三组来源:
> 1. **mock 实现的结构性局限** —— 来自 [`docs/08-nsd-control/deployment.md`](../08-nsd-control/deployment.md#7-升级路径从-mock-迁到生产-nsd) 的 12 项升级清单
> 2. **mock vs 生产参考的 gap** —— mock 有契约但生产 `tmp/control/` 未实现,或反之
> 3. **跨组件缺陷中的 NSD 责任面** —— 来自 [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 70+ 缺陷中需要 NSD 配合解决的子集
>
> `docs/10` 的 70+ 缺陷主要指向 NSN/NSC 代码,但其中若干条(**SEC-002 / SEC-003 / SEC-005 / SEC-013 / FAIL-006 / FAIL-007 / ARCH-002 / ARCH-008**)的**根因或修复点在 NSD 侧**,本页单独列出。
>
> 字段约定:**P0** 影响生产安全 / 可用性 · **P1** 严重影响功能或运维 · **P2/P3** 待优化。审查依据: HEAD 2026-04-20。

## 1. mock 实现的 12 项结构性局限

来自 [08 · deployment.md §7 升级路径](../08-nsd-control/deployment.md#7-升级路径从-mock-迁到生产-nsd)。从 mock 迁生产必须做到的 checklist,每一项都是 mock 当前缺少的能力:

| ID | 一句话 | 严重度 (生产化视角) | 修复方向 |
| -- | ------ | ------------------ | -------- |
| NSD-MOCK-01 | **所有 HTTP 端点走明文 HTTP**,mock 没有 TLS 终结 | P0 (生产不可用) | 前置 traefik / ingress 终结 TLS |
| NSD-MOCK-02 | **JWT 使用 `alg: none`**,任何人可伪造 token | P0 (生产不可用) | RS256 / ES256 + 暴露 `/.well-known/jwks.json` |
| NSD-MOCK-03 | **authkey 仅判"非空字符串即过"** (`auth.ts:107`);无一次性 / 限用次数 / 过期 / 撤销 | P0 | `authKeys` 表 + 原子减次数 + 绑定 org / site |
| NSD-MOCK-04 | **device_flow 的 `/device` 页面是占位** | P1 | 真实用户批准 UI + 登录态校验 |
| NSD-MOCK-05 | **heartbeat 路由不校验 JWT**,任何人可刷 `last_heartbeat` | P1 | 要求 JWT 且 `sub == body.machine_id` |
| NSD-MOCK-06 | **gateway/report 路由不校验 JWT**,任何人可注册"假网关" | P1 | 要求 gateway JWT |
| NSD-MOCK-07 | **`acl_config` 事件永远不推** (mock 未实现) | P0 (NSN 启动 fail-open 窗口 —— 见 SEC-008) | 生产由 `roles` / `userResources` 合成下发 |
| NSD-MOCK-08 | **SSE 订阅表是进程内 `Map<subscriberId, Subscriber>`**,多实例不可用 (`registry.ts:82`) | P1 | Redis pub/sub 广播 + sticky session |
| NSD-MOCK-09 | **无数据库 / 无 migration**,重启即丢全部 registry / services / subscribers 状态 (`registry.ts:1-424`) | P0 | drizzle ORM + PostgreSQL / SQLite |
| NSD-MOCK-10 | **可观测性仅 `console.log`**,无 metrics / trace / 结构化日志 | P1 | Prometheus + OpenTelemetry |
| NSD-MOCK-11 | **无审计日志**,谁改过什么无从追溯 | P1 | `requestAuditLog` 表 + 敏感操作告警 |
| NSD-MOCK-12 | **无证书自动化**,HTTPS 要手工配 | P2 | Let's Encrypt / 企业 CA |

## 2. mock vs 生产参考的契约 gap

### 2.1 mock 有契约但生产 `tmp/control/` 未实现

| gap | 说明 | 影响 |
| --- | ---- | ---- |
| `POST /api/v1/machine/register` | 生产栈没有此路由,Pangolin 用的是自己的 `newts` / `olms` 注册流程 | 生产无法对接 NSN/NSGW |
| `POST /api/v1/machine/auth` (Ed25519 签名) | 生产栈用 session cookie / JWT 登录,没有机器签名验签 | 同上 |
| `POST /api/v1/services/report` | 生产栈没有"NSN 自报告 services"的 endpoint | NSN 无法上报本地服务白名单 |
| `POST /api/v1/gateway/report` | 生产栈的 gateway 信息来自 `tmp/gateway/` 轮询 `/gerbil/get-config`,反向 | NSGW 协议不对齐 |
| `GET /api/v1/config/stream` (SSE 8 类事件) | 生产栈完全不提供 SSE 下发 | 数据面没有配置推送 |
| `POST /api/v1/device/code` / `/device/token` (RFC 8628) | 生产栈有 WebAuthn / OIDC 但没有 device flow | 无浏览器设备(CI / server)无法登录 |

**本质**: mock 和生产栈是两个独立实现,**契约尚未融合**。[11 · roadmap MVP 目标](../11-nsd-nsgw-vision/roadmap.md#phase-1--mvp-2-季度) 的核心任务之一就是"把 mock 的 `addSubscriber` / `handleServicesReport` 等逻辑迁到生产栈,保留 API 路径不变"。

### 2.2 生产参考有但 mock / 主契约未定义

| 能力 | 生产参考已有 | 契约缺口 |
| ---- | ----------- | -------- |
| OIDC / SAML / WebAuthn | `tmp/control/src/app/auth/` | 需定义"外部 IdP 登录后如何获得 machine-level JWT" |
| Organization (多租户) | `tmp/control/src/app/[orgId]/` 行级 orgId | `RegisterRequest` 需加 `org_id` 字段 |
| Resources / Roles / UserResources | `schema.ts:107/376/460` | `acl_config` 的生产合成逻辑未在 mock 中体现 |
| Blueprint / Share Link / Provisioning Key | `tmp/control/src/app/[orgId]/settings/*` | 无对应 NSD → NSN 推送契约 |
| Billing ingest | `tmp/control/src/app/[orgId]/settings/(private)/billing/` | 需 `POST /api/v1/billing/ingest` 新契约(NSGW→NSD) |

## 3. 跨组件缺陷中的 NSD 责任面

### 3.1 SEC-002 · `to_http_base()` 在 noise/quic 部署下静默降级到明文 HTTP(P0)

- **症状**: NSN 侧 `to_http_base()`(`crates/control/src/auth.rs:15-23`)把 `noise://` / `quic://` URL 重写成 **`http://`**(非 https),`register` / `authenticate` / `heartbeat` 这 3 个最敏感 HTTP API **绕过了 Noise/QUIC 加密**,在初始信任建立时走明文。
- **NSD 责任**: 需要**同时开放 https 入口**(端口 8443),并和 NSN 协商"Noise/QUIC 部署下 HTTP API 走 https"。
- **迁移风险**: 高 —— 现有部署可能只开 http,文档 + 部署指南要配套。
- **修复方案**: 要么 NSD 强制 https,要么 NSD 把 register/auth/heartbeat 也装进 Noise/QUIC transport(见 ARCH-008)。
- **原文**: [SEC-002](../10-nsn-nsc-critique/security-concerns.md#sec-002)

### 3.2 SEC-003 · `authenticate` 签名仅含本地时间戳,无 server nonce → 重放窗口(P1)

- **症状**: 签名 input 是 `"{machine_id}:{unix_secs}"`,skew 容忍 300s,只要窗口内截获就能重放;多 NSD 场景下同一签名可被 NSD A 泄露后用于 NSD B。
- **NSD 责任**: 新增 `POST /api/v1/machine/auth/challenge` 发放 `{nonce, expires_at}`,`authenticate` 把 `nonce` + `nsd_url`(或 NSD 公钥)嵌入签名 input。
- **Cost**: ~2 人日(含 NSD 端配套)。
- **迁移风险**: 中 —— 需要协议版本协商,旧 NSD 不识别 challenge 端点。
- **原文**: [SEC-003](../10-nsn-nsc-critique/security-concerns.md#sec-003)

### 3.3 SEC-005 / ARCH-002 / FAIL-006 · 多 NSD ACL 合并曾使用交集 `[RESOLVED]`

- **症状**: `crates/control/src/merge.rs` 原本用"交集"合成最终 ACL,**任一 NSD 推空 ACL 即清空全局策略**,叠加 SEC-001 fail-OPEN 路径就等同于"无 ACL"。若 NSD 中存在恶意 / 被攻陷实例,可主动推空 ACL 拆掉所有其他 NSD 的策略。
- **决议 (2026-04-17)**: 采用 [ARCH-002](../10-nsn-nsc-critique/architecture-issues.md#arch-002) 选项 1 —— **合并改并集 + 每条规则 `sources` 标注 + 本地 `services.toml` ACL 作为运行时保底**。空 ACL 不再清空其他 NSD 规则;单 NSD 被攻陷下发 `allow all` 也无法越过本地 ACL。
- **NSD 侧配套**: 每次 ACL 下发推送 `chain_id` + 源 NSD 标识;推送前后写 hash + 规则数 diff 到审计日志。
- **原文**: [SEC-005](../10-nsn-nsc-critique/security-concerns.md#sec-005) · [ARCH-002](../10-nsn-nsc-critique/architecture-issues.md#arch-002) · [FAIL-006](../10-nsn-nsc-critique/failure-modes.md#fail-006)

### 3.4 SEC-013 · NSGW 推送的 WSS Open frame 缺 source identity `[RESOLVED]`

- **症状**: NSGW→NSN 的 WSS Open frame 只有目的地址,缺 source identity(user / NSC machine_id),NSN 无法做 per-connection 审计。
- **决议**: 已决议加 TLV 扩展字段承载 source identity;NSD 需在 `acl_projection`(生产契约新增)中下发 Subject::User/Group/Nsgw 维度,让 NSGW 做 ingress 预过滤。
- **NSD 责任**: 实现 `acl_projection` 事件推送(mock 未实现),仅对 machine_type=gateway 的订阅者 push。
- **原文**: [SEC-013](../10-nsn-nsc-critique/security-concerns.md#sec-013)

### 3.5 SEC-008 / FAIL-002 · ACL 加载 10s 超时后继续启动(P0)

- **NSN 侧症状**: `acl_config_rx.recv()` 10s 超时后 NSN 继续运行,ACL 永久缺失,数据面 fail-OPEN。
- **NSD 责任面**: **mock 永远不推 `acl_config`**,所以 NSN 在 mock 环境下永远命中此 fail-OPEN 窗口。生产 NSD 必须在订阅建立后立即下发 ACL(即使是空规则集也要下发版本 0)。
- **修复**: mock 补充 `sendAclConfig`;生产 NSD 确保 SSE 订阅建立后 2s 内推 `acl_config`(即使空)。
- **原文**: [SEC-008](../10-nsn-nsc-critique/security-concerns.md#sec-008) · [FAIL-002](../10-nsn-nsc-critique/failure-modes.md#fail-002)

### 3.6 FAIL-007 · 控制面 backoff 指数退避时 token 过期,重连后 401 再退避(P1)

- **症状**: SSE 断开后 NSN 按指数退避重连;退避时间 > JWT 有效期时,重连即 401 → 再退避,雪崩。
- **NSD 责任**: ① 延长 JWT 有效期或支持 refresh_token;② 实现 `token_refresh` SSE 事件(mock 未触发);③ 401 时 NSN 应立即走 `authenticate` 续签而非退避。
- **原文**: [FAIL-007](../10-nsn-nsc-critique/failure-modes.md#fail-007)

### 3.7 ARCH-008 · 控制面 HTTP API 与可插拔 transport 解耦不彻底

- **症状**: `register` / `authenticate` / `heartbeat` / `services/report` / `gateway/report` 5 个 HTTP API 始终走 `to_http_base()`,**不经过** Noise / QUIC transport。可插拔传输层形同虚设。
- **NSD 责任**: ① 在 Noise / QUIC listener 后也暴露这 5 个 HTTP API(mock `noise-listener.ts:295` 已用透明代理模式,但需确认 quic 路径);② 契约层明确声明"所有控制面 API 必须可在三种 transport 上运行"。
- **原文**: [ARCH-008](../10-nsn-nsc-critique/architecture-issues.md#arch-008)

### 3.8 SEC-015 · 没有审计日志 / 没有"安全事件"流出口(P1)

- **症状**: NSN/NSC 侧没有统一审计事件流,ACL deny / auth fail / config rollback 不能导出到外部 SIEM。
- **NSD 责任**: 对称问题也存在于 NSD —— mock 只 `console.log`,生产需 `requestAuditLog` 表 + 结构化 logger + S3 / Splunk 导出(见 F4.7 / F4.12)。
- **控制面新契约**: `POST /api/v1/events`(Any → NSD)作为通用事件上报通道(见 [vision.md §8](./vision.md#8-控制面契约演进跨组件))。
- **原文**: [SEC-015](../10-nsn-nsc-critique/security-concerns.md#sec-015)

## 4. NSD 生产化的优先级

### 4.1 P0 必修(阻断生产化)

| ID | 一句话 | 修复目标 |
| -- | ------ | -------- |
| NSD-MOCK-01 | 明文 HTTP | 前置 TLS |
| NSD-MOCK-02 | JWT `alg:none` | RS256/ES256 + JWKS |
| NSD-MOCK-03 | authkey 无验证 | 查表 + 原子减次 |
| NSD-MOCK-07 | `acl_config` 不推 | 生产必须从 SSE 订阅建立后立即下发 |
| NSD-MOCK-09 | 无持久化 | drizzle + SQLite(MVP)/Postgres(GA) |
| SEC-002 | HTTP API 明文降级 | NSD 开 https + Noise/QUIC 覆盖 HTTP API |
| SEC-005 (fix) | 多 NSD ACL 空配攻击 | 审计日志 + 本地 ACL 保底配套 |

### 4.2 P1 重要(阻断企业销售)

| ID | 一句话 |
| -- | ------ |
| NSD-MOCK-04 | device_flow UI 占位 |
| NSD-MOCK-05/06 | heartbeat / gateway_report 无 JWT |
| NSD-MOCK-08 | SSE 订阅表单机 |
| NSD-MOCK-10/11 | 无可观测 / 无审计 |
| SEC-003 | 签名无 server nonce(重放) |
| FAIL-007 | token 过期触发退避雪崩 |
| ARCH-008 | HTTP API 绕过可插拔 transport |
| SEC-015 | 无审计事件流出口 |

### 4.3 P2/P3 待优化

- SEC-013 WSS Open frame 缺 source identity (已决议加 TLV + `acl_projection`)
- SEC-012 QUIC 信任只靠 fingerprint(无法轮换吊销)
- SSE 快照 CDN 化(F6.9 企业级)
- 跨区 NSD(F6.3 企业级)

## 5. NSD 特有风险(来自 deployment / roadmap)

来自 [11 · roadmap §MVP 风险](../11-nsd-nsgw-vision/roadmap.md#mvp-风险):

| 风险 | 应对 |
| ---- | ---- |
| 从 mock 迁生产时 API 漂移 | 契约测试(E2E 全套重跑) |
| Next.js 版本与 NSIO 栈其他部分不兼容 | 独立部署 |
| gerbil 的 config 轮询模型与 NSIO SSE 推送不一致 | 先做 adapter 层,不直接改 gerbil |
| Pangolin fork 带来的 GPL/AGPL 法律风险 | 尽早审查 license,必要时重写关键模块 |
| 多实例 NSD 的 SSE subscriber 分发 | 外置 Redis subscriber registry;或走负载均衡 sticky |
| Terraform Provider 与 Web UI 状态漂移 | 提供 `data "nsio_*"` 数据源 |
| 多 NSD 联邦管理 UX 难设计 | 先做"只读视图"最小版,迭代 |
| SOC2 Type II 需 6 个月运行记录 | Phase 2 末启动,Phase 3 末拿到 |

## 6. 不在修复范围内

- **把 mock 重写成 Rust**: 无需求驱动,Rust 数据面 + TS/Node 控制面是已经稳定的组合。
- **重构 Pangolin fork**: MVP 阶段成本太高;保留 fork 是 2 季度交付的前提。
- **SSE 换 gRPC streaming**: SSE 对 DPI 友好,生态工具链丰富。
- **把策略引擎换成 OPA / Cedar**: 表达力够用,引入新依赖维护成本高(同 [nsn/vision §8 不在路线图内的事项](../nsn/vision.md#8-不在路线图内的事项明确放弃--延后))。

---

更详细的缺陷 9-字段描述见 `docs/10-nsn-nsc-critique/` 原章节;mock ↔ 生产差异详见 `docs/08-nsd-control/deployment.md`;生产化路线见 [vision.md](./vision.md) 与 [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md)。
