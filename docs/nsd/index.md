# NSD · 控制中心全景

> **NSD (Network Service Director)** —— NSIO 生态里**唯一有状态的强一致组件**。它是身份签发者、策略编排者、配置分发者,但**不承载任何业务流量**。一切"谁是谁""谁能访问什么""网关拓扑长什么样"的知识都由 NSD 集中维护,再通过 SSE 单向推到 NSN / NSGW / NSC。
>
> 本目录是 **NSD 主题门户**:把分散在 `docs/08-nsd-control`(当前契约)、`docs/11-nsd-nsgw-vision`(生产化远景)、`docs/10-nsn-nsc-critique`(跨组件缺陷中与 NSD 相关的子集)的内容汇总到一处,方便按视角查阅。原章节保持不变,本目录是它们的二次组织。

## 1. NSD 是什么

- **位置**: 控制面中心(SaaS / 自托管 / 客户私有化)。和数据面的 NSN / NSGW / NSC 形成"1 个 NSD × N 个数据面节点"的星型拓扑。
- **入站**: `POST /api/v1/machine/register` (首次注册) · `POST /api/v1/machine/auth` (签名换 JWT) · `POST /api/v1/device/code/token` (RFC 8628) · `POST /api/v1/services/report` (NSN 上报本地白名单) · `POST /api/v1/gateway/report` (NSGW 上报 endpoint) · `POST /api/v1/machine/heartbeat` (60s 存活)。
- **出站 (SSE)**: `GET /api/v1/config/stream` 单向推送 `wg_config / proxy_config / acl_config / gateway_config / routing_config / dns_config / services_ack / token_refresh` 共 8 类事件。
- **核心不变式**: NSD **永远不应看到私钥** —— `WgConfig` 故意不含 `private_key` 字段(`crates/control/src/messages.rs:12`)。
- **两种实现**: `tests/docker/nsd-mock/` (Bun/TS,内存 registry,E2E 专用) 与 `tmp/control/` (Next.js + drizzle ORM + Postgres/SQLite,Pangolin fork,生产参考)。**目前两者未对接** —— mock 定义了权威 API 契约,生产栈已有 UI/DB,但还没实现这套 API。

完整组件全景见 [01 · 系统总览](../01-overview/index.md);本门户聚焦 NSD 视角。

## 2. 三个视角入口

| 文档 | 你想了解 | 主要来源 |
| ---- | -------- | -------- |
| [features.md](./features.md) | NSD **当前能做什么** —— 五大职责、API 契约、SSE 事件、三把密钥、多 realm 合并、mock vs 生产差异 | [`docs/08-nsd-control/`](../08-nsd-control/index.md) 7 篇 |
| [vision.md](./vision.md) | NSD **未来要做什么** —— 六大能力轴(身份/策略/编排/可观测/运营/高可用) × MVP/GA/企业级三档 | [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) nsd-capability-model / nsd-vision / control-plane-extensions |
| [bugs.md](./bugs.md) | NSD **当前有什么坑** —— mock 实现的局限、生产化 gap、跨组件缺陷中 NSD 相关部分 | `docs/08-nsd-control/deployment.md` §7 + [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) NSD 侧子集 |

## 3. 一屏速览

| 维度 | 现状 (HEAD 2026-04-20) | 生产级目标 |
| ---- | ---------------------- | ---------- |
| 持久化 | 进程内 `Map<machineId, MachineRecord>`,重启即丢 | Postgres (主推) / SQLite (单机 MVP) via drizzle ORM |
| 认证方式 | authkey 明文、device_flow、Ed25519 签名(mock JWT `alg:none`) | 真实 RS256/ES256 签名 + JWKS 暴露 + 吊销机制 |
| ACL 下发 | **mock 未实现 `acl_config` 事件推送** | 按 roles / userResources 合成 + 版本号 + 一键回滚 + 灰度发布 |
| 多租户 | 仅 `realm` 字段,无 org 隔离 | 行级 orgId 隔离(MVP)+ 独立 schema/DB 可选(企业) |
| 身份提供者 | 无 (只有 authkey / device_flow) | OIDC(MVP)+ SAML 2.0(GA)+ SCIM(GA)+ 2FA/WebAuthn |
| Web UI | 无(mock 仅 `/api/v1/services` 快照) | Next.js 15 + shadcn/ui,14 类设置页,i18n 10 种语言 |
| 多 NSD 并行 | NSN 侧已支持 `MultiControlPlane`,NSD 间互不感知 | NSD 联邦(企业级):只读视图 + 跨 NSD 审计关联 + 策略冲突检测 |
| 审计日志 | 仅 `console.log` | 结构化 + S3 导出 + SIEM 对接(Splunk HEC / Sentinel) |
| 策略 DSL | ❌ JSON 硬编码 | 类 Rego / CEL / HuJSON;NSD 编译,NSN/NSGW 只见编译产物 |
| 控制面传输 | SSE(HTTP/1.1 over rustls) + Noise IK + QUIC(fingerprint pin) | 同上 + `ca_bundle_update` 证书热更新 + 协议版本协商 |
| 生态集成 | 无 | Terraform provider · TS/Python/Go/Rust SDK · Webhook · k8s Operator |

## 4. NSD 的五大职责(一张速查表)

| 职责 | 当前实现 | 生产目标 |
| ---- | -------- | -------- |
| ① 设备注册表 (Registry) | `tests/docker/nsd-mock/src/auth.ts:35` + `registry.ts:41` · 幂等注册(客户端可预派 `machine_id`) | 持久化到 Postgres · RBAC · Machine PKI · 硬件绑定 |
| ② 认证服务 (Auth) | authkey + device_flow + Ed25519 签名 → mock JWT | 真实 JWT(RS256/ES256)+ 吊销 + challenge-response + API Key 三层 |
| ③ 策略引擎 (Policy) | 从 services_report 自动合成,**不下发 `acl_config`** | 显式 RBAC(resources/roles/userResources 联动)+ 策略版本 + 灰度 + DSL |
| ④ 配置分发 (SSE) | 订阅表是进程内 `Map<subscriberId, Subscriber>` | Redis pub/sub 广播 + sticky session + SSE 快照 CDN 化 |
| ⑤ Web UI / Admin API | mock 无 UI;`tmp/control/` 已有 Next.js 完备框架但未对接 mock 契约 | 完整 UI + OpenAPI + CLI(`nsdctl`)+ 多语言 SDK + Webhook + TF provider |

详见 [features.md §1 五大职责](./features.md#1-五大职责) / [08 · responsibilities.md](../08-nsd-control/responsibilities.md)。

## 5. 本门户与原章节的关系

- **不复制内容,做组织**: 本目录里所有详细描述都链接回原章节,契约 / 远景 / 缺陷条目均带 `path:line` 锚点。
- **不删除原章节**: `docs/08` / `docs/10` / `docs/11` 都被其他章节交叉引用,移动会破坏链接。
- **更新策略**: 原章节内容更新时,本门户的"摘要 / 索引"需要同步;生产化改造落地后在 [bugs.md](./bugs.md) 相应条目标 `[RESOLVED in <hash>]`。

## 6. 推荐阅读顺序

1. **第一次接触 NSD** → [features.md §1 五大职责](./features.md#1-五大职责) → [features.md §2 API 契约](./features.md#2-api-契约-rest--sse)
2. **要对接 NSD(开发 NSN / NSGW 新客户端)** → [features.md §2-4](./features.md#2-api-契约-rest--sse) → [08 · api-contract](../08-nsd-control/api-contract.md) + [08 · sse-events](../08-nsd-control/sse-events.md)
3. **要部署多 Realm / 多 NSD** → [features.md §6 多 Realm 与多 NSD](./features.md#6-多-realm-与多-nsd) → [08 · multi-realm](../08-nsd-control/multi-realm.md)
4. **要从 mock 迁生产** → [bugs.md §1 mock 局限](./bugs.md#1-mock-实现的-12-项结构性局限) → [08 · deployment §7](../08-nsd-control/deployment.md#7-升级路径从-mock-迁到生产-nsd)
5. **要规划产品演进** → [vision.md §1 六大能力轴](./vision.md#1-六大能力轴) → [vision.md §9 分级落地](./vision.md#9-分级落地-mvp--ga--企业级)
6. **要对比竞品** → [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) (60+ 功能 × tailscale / headscale)
