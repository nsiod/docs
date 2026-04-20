# NSD · 功能全景

> 本页是 NSD **当前实现**(mock + 可证实参考) 的精简索引。详细描述请到 [`docs/08-nsd-control/`](../08-nsd-control/index.md) 7 篇原文档。
>
> 口径: **mock 里已有** / **生产 `tmp/control/` 参考里已有** / **仅契约草案、无任一侧实现** 三档分开标注。不猜测未来,只罗列源码可证实的能力。

## 1. 五大职责

NSD 可拆成五条相对独立的职责线(`docs/08-nsd-control/responsibilities.md`):

| 职责 | mock 实现 | 生产参考 | 说明 |
| ---- | -------- | -------- | ---- |
| ① **设备注册表 (Registry)** | `tests/docker/nsd-mock/src/auth.ts:35` + `registry.ts:41` 内存 Map | `tmp/control/server/db/pg/schema/schema.ts` 的 `users` / `newts` / `olms` 表 | Machine + Gateway 两类,幂等注册 |
| ② **认证服务 (Auth)** | `auth.ts:1-443` authkey / device_flow / Ed25519 签名 | `tmp/control/server/auth/sessions/` session + 2FA + WebAuthn | 三条首次路径 + 一条续签 |
| ③ **策略引擎 (Policy)** | 由 `services_report` 自动合成 proxy/routing/dns | `tmp/control/server/db/pg/schema/schema.ts:107` resources / `:376` roles / `:460` userResources | mock 没 ACL;生产靠三表联动 |
| ④ **配置分发 (SSE)** | `registry.ts:82` `Map<subscriberId, Subscriber>` | 需 Redis pub/sub + sticky session | 单向推送 8 类事件 |
| ⑤ **Web UI / Admin API** | 仅 `GET /api/v1/services` 快照 | `tmp/control/src/app/[orgId]/settings/` 14 类设置 + 100+ 组件 + 10 种语言 | mock 几乎为空,生产已有 UI 但未对接 mock 契约 |

职责依赖顺序(`responsibilities.md §"五职责的依赖顺序"`):
- Auth 依赖 Registry(校验签名要 `machine_key_pub`)
- SSE 依赖 Registry(决定订阅者身份)+ Policy(决定推什么)
- Admin UI 是唯一写路径,最终写回 Registry / Policy 存储

详见 → [08 · responsibilities.md](../08-nsd-control/responsibilities.md)

## 2. API 契约 (REST + SSE)

### 2.1 发现与健康

| Method | Path | Request | Response | Auth | 源 |
| ------ | ---- | ------- | -------- | ---- | -- |
| GET | `/api/v1/info` | — | `NsdInfoResponse` | 无 | `nsd-mock/src/auth.ts:316` · `crates/control/src/auth.rs:281` |
| GET | `/ready` | — | `"ok"` | 无 | `auth.ts:337` |

`NsdInfoResponse` 关键字段 (`types.ts:159`): `type ("cloud"|"selfhosted")` · `realm` · `auth_methods` · `provider` · `version` · 可选 `nsd_noise_pubkey` / `nsd_quic_pubkey`。

### 2.2 注册与认证 (5 条)

| Method | Path | 触发 | 认证 | 源 |
| ------ | ---- | ---- | ---- | -- |
| POST | `/api/v1/machine/register` | 首次注册 / authkey 幂等启动 | `auth_key` in body 或 `Bearer <device_flow_token>` | `auth.ts:91` · `crates/control/src/auth.rs:176-207` |
| POST | `/api/v1/machine/auth` | 每次启动 / JWT 快过期 | 签名(无 header) | `auth.ts:174` · `auth.rs:237-272` |
| POST | `/api/v1/device/code` | 无 authkey 且 NsdInfo 支持 device_flow | 无 | `auth.ts:224` · `crates/control/src/device_flow.rs:52` |
| POST | `/api/v1/device/token` | 客户端按 `interval` 轮询 | 无 | `auth.ts:271` · `device_flow.rs:100` |
| POST | `/api/v1/machine/heartbeat` | NSN 后台定时(默认 60s) | 无(建议 JWT,mock 不校验) | `auth.ts:376` · `auth.rs:83` |

### 2.3 数据面上报 (2 条)

| Method | Path | 触发 | 副作用 | 源 |
| ------ | ---- | ---- | ------ | -- |
| POST | `/api/v1/services/report` | NSN 启动前 & `services.toml` 变更 | 对应 NSN push `wg_config + gateway_config + proxy_config + services_ack + dns_config`;broadcast 给 NSGW `wg_config + routing_config`;broadcast 给非 gateway `dns_config` | `index.ts:82` · `registry.ts:364-388` |
| POST | `/api/v1/gateway/report` | NSGW 启动 / WG endpoint 变化 | broadcast `wg_config`(peer 列表) + `gateway_config`(NSC 用) | `index.ts:93` · `registry.ts:395-412` |

### 2.4 配置流 (SSE, 1 条长连)

| Method | Path | 方向 | 触发 |
| ------ | ---- | ---- | ---- |
| GET | `/api/v1/config/stream` | NSD → 订阅者 | 订阅建立 / 任一 report 引发的 push |

详见 → [08 · api-contract.md](../08-nsd-control/api-contract.md)

## 3. SSE 事件字典

`GET /api/v1/config/stream` 推 11 类事件(`crates/control/src/messages.rs:207-228` 的 `ControlMessage` 枚举, `#[serde(tag = "type", rename_all = "snake_case")]`):

| `type` | 方向 | 触发 | 消费者 | 源 |
| ------ | ---- | ---- | ------ | -- |
| `wg_config` | NSD → 订阅者 | services_report / gateway_report / 订阅建立 | NSN · NSGW | `messages.rs:12` |
| `proxy_config` | NSD → NSN | services_report 后 | NSN(`Proxy` / `ServiceRouter`) | `messages.rs:28` |
| `acl_config` | NSD → NSN | 管理员变更 ACL(**mock 未实现**) | NSN(`ipv4-acl`,终决者) | `messages.rs:56` |
| `acl_projection` | NSD → NSGW | 同 `acl_config` 触发(**mock 未实现**,生产契约) | NSGW(`/client` ingress 预过滤) | 生产契约 |
| `services_ack` | NSD → NSN | services_report 之后 | NSN(matched / unmatched / rejected) | `messages.rs:126` |
| `gateway_config` | NSD → NSN/NSC | gateway_report / 订阅建立 | NSN · NSC(选路) | `messages.rs:200` |
| `routing_config` | NSD → NSGW | services_report / 订阅建立 | NSGW(traefik provider) | `messages.rs:157` |
| `dns_config` | NSD → NSN/NSC | services_report 后 | NSC(本地 DNS) | `messages.rs:178` |
| `token_refresh` | NSD → 任意 | JWT 快过期(**mock 未实现**) | 全体(SseControl 更新 header) | `messages.rs:213` |
| `ping` / `pong` | NSD → 任意 | 空闲心跳(**mock 未实现**) | 全体 | `messages.rs:216-217` |

详见 → [08 · sse-events.md](../08-nsd-control/sse-events.md)

## 4. 认证体系(三把密钥)

| 密钥 | 算法 | 私钥去向 | 用途 | NSD 侧存储 |
| ---- | ---- | -------- | ---- | ---------- |
| **machinekey** | Ed25519 | 永不离开节点(`{state_dir}/machinekey.json`, 0600) | 签名 `"{machine_id}:{unix_secs}"` | `machine_key_pub` |
| **peerkey** | X25519 | 永不离开节点(同文件) | WireGuard peer 公钥 | `peer_key_pub` |
| **authkey** | 预共享字符串 | 注册成功后 NSN 丢弃 | 证明注册请求授权 | 生产态查 `authKeys` 表并 mark-as-used |

**关键不变式**: NSD 永远不应收到、存储、转发任何**私钥**。`WgConfig` 故意不含 `private_key` 字段(`messages.rs:12`,测试见 `messages.rs:263-269`)。

三条首次注册路径 + 一条续签:

1. **authkey** (`POST /register` body.auth_key) —— mock 只判"非空字符串即过"(`auth.ts:107`);生产必须查表 + 原子减次数 + 绑 org/site。
2. **device-flow** (RFC 8628, `POST /device/code` → 轮询 `POST /device/token` → Bearer token 调 `/register`)。
3. **signature auth** (每次启动) —— `POST /machine/auth` 带 Ed25519 签名换 JWT。mock 是 `alg: none`,生产必须 RS256/ES256。验证逻辑: `auth.ts:192-212` 做 ①查 registry ②时间戳 skew ≤ 300s ③验签。
4. **token_refresh** (运行中) —— SSE 推 `ControlMessage::TokenRefresh`,客户端无需重新签名。

详见 → [08 · auth-system.md](../08-nsd-control/auth-system.md)

## 5. 数据模型

mock 实现 (`registry.ts` / `auth.ts`): 全部是进程内 `Map`。

| 实体 | 容器 | 关键字段 |
| ---- | ---- | -------- |
| `MachineRecord` | `machines: Map<string, MachineRecord>` | `machine_id` · `machine_key_pub` · `peer_key_pub` · `type ("connector"|"gateway")` · `system_info` · `last_heartbeat` |
| `GatewayRecord` | `gateways: Map<string, GatewayRecord>` | `gateway_id` · `wg_pubkey` · `wg_endpoint` (DNS 解析后 `ip:port`) · `wss_endpoint` |
| `ServiceState` | `nsnServices: Map<machine_id, ServicesReport>` | `services{}` · `strict_mode` · `system_info?` |
| `Subscriber` | `subscribers: Map<subscriberId, Subscriber>` | `controller`(SSE controller) · `machineId` |
| `DeviceCode` | `deviceCodes: Map<device_code, DeviceCodeRecord>` | `user_code` · `expires_at` · `approved` |

生产参考 (`tmp/control/server/db/pg/schema/schema.ts`): 70+ 张 drizzle ORM 表,核心子集包括 `users` · `orgs` · `sites` · `resources` · `targets` · `roles` · `userResources` · `gateways` · `authKeys` · `requestAuditLog` 等。

详见 → [08 · data-model.md](../08-nsd-control/data-model.md)

## 6. 多 Realm 与多 NSD

### 6.1 Realm

Realm 是**认证与状态的隔离域**,由 NSD 在 `GET /api/v1/info` 自报(`auth.ts:323`):

```jsonc
{ "type": "selfhosted", "realm": "company.internal", ... }
{ "type": "cloud",      "realm": "nsio.cloud",       ... }
```

边界:
- **认证隔离** —— 一个 realm 的 authkey / device_flow token 只能用于该 realm
- **注册状态** —— 同一机器的 `machine_id` 在不同 realm 可以不同
- **策略独立** —— realm A 的 ACL 不泄漏到 realm B

关键: **machinekey 全局唯一**,但**每个 realm 一份注册状态** —— "一台机器 = 一个身份 × N 个 realm"。

### 6.2 Cloud Shared vs Self-Hosted

| 维度 | Cloud (nsio.cloud) | Self-Hosted |
| ---- | ------------------ | ----------- |
| 部署方 | NSIO 团队 | 客户自行 |
| realm 隔离 | 单 NSD 多 realm(行级 org 隔离) | 一 NSD 一 realm(或少量 realm) |
| 策略源 | 客户管理员在 Web UI 配置 | 客户管理员 + 企业内部系统 |
| authkey 发放 | NSIO 签发 | 客户自签 |

### 6.3 多 NSD 合并(NSN 侧逻辑)

一台 NSN 可同时注册到多个 NSD。NSN 侧 `MultiControlPlane` (`crates/control/src/multi.rs`) 并发订阅,按 `resource_id` 合并去重:

- **wg / proxy / gateway / routing / dns** —— 并集(`merge_proxy_configs` 入口 `crates/control/src/merge.rs:56`,去重发生在 `:63`)
- **acl** —— 原为交集(ARCH-002/SEC-005/FAIL-006),**2026-04-17 已决议改并集 + 本地 `services.toml` ACL 保底**
- 每条规则携带来源 NSD 标注,审计 / 冲突检测可用

NSD 间**互不感知**,合并逻辑全在 NSN 侧。

详见 → [08 · multi-realm.md](../08-nsd-control/multi-realm.md)

## 7. mock vs 生产:实现形态对比

| 维度 | mock (`tests/docker/nsd-mock/`) | 生产 (`tmp/control/`) |
| ---- | ------------------------------ | --------------------- |
| 运行时 | Bun | Node.js + Next.js 15 |
| 持久化 | 进程内 `Map` | PostgreSQL / SQLite via drizzle ORM |
| Web UI | 无(仅 `/api/v1/services` 快照) | Next.js App Router + shadcn/ui |
| 身份提供者 | 无 | OIDC(`IdP` 表)+ 本地账号 + 2FA + WebAuthn |
| SSE 订阅表 | 进程内 Map | 通常配合 Redis pub/sub |
| Noise IK 握手 | 进程内 `noise-listener.ts` | 独立 proxy 二进制 |
| QUIC 握手 | spawn Rust 子进程 `/app/nsd-quic-proxy` | 独立 proxy 或 envoy/nginx-quic |
| ACL 下发 | **未实现** | 由 roles / userResources 合成 |
| 证书管理 | 无 | traefik + Let's Encrypt |
| 审计日志 | 仅 `console.log` | `requestAuditLog` 表 + 结构化 logger |
| 资源开销 | ~40 MB RSS 单进程 | 多进程(Next worker 池)+ DB |

### 7.1 mock 的三个监听器

`tests/docker/nsd-mock/src/index.ts` 启动三个监听器: Bun HTTP (默认 3000) · Noise IK (默认 8444) · QUIC (默认 8445)。关键行为:

- `idleTimeout: 0`(`index.ts:67`) —— SSE 连接不得被 Bun idle 超时杀掉
- Noise 握手成功后建立透明代理: `NSN → Noise → 解密 → HTTP → localhost:CONTROL_PORT`(`noise-listener.ts:295`)
- QUIC 走独立 Rust 子进程 `/app/nsd-quic-proxy`,mock 只启动 + 读证书指纹(`quic-listener.ts:29`)

### 7.2 NSN 侧 404 fallback

生产 NSD 必须返回 `type` / `realm` / `auth_methods`。**NSN 侧在 404 时会 fallback 成 `SelfHosted / realm=default`**(`crates/control/src/auth.rs:298-307`),老版本 NSD 兼容。

### 7.3 从 mock 迁生产的 12 项 checklist

来自 [08 · deployment.md §7](../08-nsd-control/deployment.md#7-升级路径从-mock-迁到生产-nsd):

- [ ] 所有 HTTP 端点走 TLS
- [ ] 启用真实 JWT 签名(RS256 / ES256),暴露 `/.well-known/jwks.json`
- [ ] authkey 表实现一次性 / 限用次数 / 过期 / 可撤销
- [ ] device_flow 的 `/device` 页面实现真实用户批准 UI
- [ ] heartbeat 路由要求 JWT 且 `sub == body.machine_id`
- [ ] gateway/report 路由要求 JWT(gateway 的 JWT)
- [ ] **实现 `acl_config` 事件下发(mock 没做)**
- [ ] SSE 订阅多实例广播(Redis / NATS)
- [ ] 数据库迁移脚本(drizzle migration)
- [ ] Prometheus 指标 + OpenTelemetry trace
- [ ] 审计日志 + 敏感操作告警
- [ ] 证书自动化(Let's Encrypt / 企业 CA)

详见 → [08 · deployment.md](../08-nsd-control/deployment.md)

## 8. 关键文件(NSD 源码 / 参考地图)

| 文件 | 行数 | 职责 |
| ---- | ---- | ---- |
| `tests/docker/nsd-mock/src/index.ts` | 131 | Bun.serve 主入口,路由分发 |
| `tests/docker/nsd-mock/src/auth.ts` | 443 | authkey / device_flow / 签名认证 / JWT 签发 |
| `tests/docker/nsd-mock/src/registry.ts` | 424 | Machine / Gateway / Subscriber / Services 全量内存状态 |
| `tests/docker/nsd-mock/src/types.ts` | 266 | 核心实体 TypeScript 定义 |
| `tests/docker/nsd-mock/src/noise-listener.ts` | — | Noise IK 握手 + 透明代理 |
| `tests/docker/nsd-mock/src/quic-listener.ts` | — | QUIC 子进程启动 + 证书指纹读取 |
| `tests/docker/nsd-mock/src/config.ts` | — | 环境变量解析 |
| `crates/control/src/auth.rs` | — | NSN 侧对端: `discover_nsd_info` / `register` / `authenticate` / `heartbeat` |
| `crates/control/src/sse.rs` | — | NSN 侧 SSE 消费者 |
| `crates/control/src/messages.rs` | — | `ControlMessage` 枚举定义(11 类事件) |
| `crates/control/src/merge.rs:56` | — | 多 NSD 配置按 `resource_id` 合并去重 |
| `crates/control/src/multi.rs` | — | `MultiControlPlane` 多控制面聚合 |
| `tmp/control/src/app/` | — | 生产 Next.js App Router 全套 UI |
| `tmp/control/server/db/pg/schema/schema.ts` | — | 70+ drizzle 表 schema |
| `tmp/control/server/routers/` | — | tRPC-like 路由集(30+ 组) |
| `tmp/control/cli/commands/` | — | 7 条 admin CLI(clearExitNodes / rotateServerSecret 等) |

---

更详细的功能展开请按需打开:

- [08 · index](../08-nsd-control/index.md) · NSD 章节导航
- [08 · responsibilities](../08-nsd-control/responsibilities.md) · 五大职责细节
- [08 · api-contract](../08-nsd-control/api-contract.md) · REST + SSE 完整表
- [08 · auth-system](../08-nsd-control/auth-system.md) · 三把密钥 × 协议流程 × JWT
- [08 · sse-events](../08-nsd-control/sse-events.md) · 11 类事件字段与触发条件
- [08 · data-model](../08-nsd-control/data-model.md) · mock + 生产 ER 对照
- [08 · multi-realm](../08-nsd-control/multi-realm.md) · Realm × 多 NSD 并发
- [08 · deployment](../08-nsd-control/deployment.md) · mock vs 生产 × 运维 × 升级
