# NSD · 远景与演进

> 本页是 [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 中**与 NSD 相关**的能力汇总 —— 87 项 NSD 功能按 6 条能力轴组织,每项标注 MVP / GA / 企业级落地级别,并指向原文详情。

## 0. 愿景陈述

**把"Rust 数据面 + Bun/TS mock + Pangolin 生产参考"这三件套,融合成一套生产级控制中心**,对标 tailscale 控制中心 / headscale / zerotier controller / cloudflare WARP。

NSIO 的**独立价值主张**(不可放弃):

1. **多 NSD 并行** —— 同一 NSN 可同时向多个 NSD 注册,策略按 `resource_id` 合并去重(`crates/control/src/merge.rs:56`)。企业可把一个节点同时接入**甲方 cloud NSD + 自建 NSD**。
2. **协议可插拔的控制面** —— SSE / Noise / QUIC 三套传输共用同一个事件解析器。DPI 严苛网络下,直接上 QUIC/Noise,不需要 bootstrap 切换。
3. **`.ns` 命名空间 + 127.11.x.x VIP** —— 不需要 TUN / 不需要管理员权限。NSIO 可在受限终端(企业笔记本 / CI runner / Android App 沙箱)里跑。
4. **代理即 NAT** —— ACL 是"仅允许",默认拒绝,合规审计友好。

其余(多租户 / RBAC / IdP / Webhook / Web UI / CLI / Terraform / 多区域 / DDoS / 边缘)都是**行业共同底线**,做不到就没法卖给企业、没法运营 SaaS。

完整版愿景陈述 → [11 · index §愿景陈述](../11-nsd-nsgw-vision/index.md#愿景陈述)

## 1. 六大能力轴

NSD 生产化能力组织成 6 条正交轴(详见 [11 · nsd-capability-model](../11-nsd-nsgw-vision/nsd-capability-model.md)):

| 轴 | 主问题 | MVP | GA | 企业级 |
| -- | ------ | --- | -- | ------ |
| ① **身份与组织** (Identity & Org) | "谁是谁,谁属于哪个组织" | OIDC + 本地账号 | SAML 2.0 + SCIM | HSM + ABAC + Machine PKI |
| ② **策略与编排** (Policy) | "谁能访问什么,怎么路由" | 硬编码 ACL | 版本号 + 灰度 + 测试工具 | DSL(Rego/CEL)+ 仿真 + Posture |
| ③ **网络编排** (Topology) | "站点与网关如何组网" | 单区 | 多区 + GeoDNS | 流量工程 + 跨站点 P2P + 拓扑编辑器 |
| ④ **可观测与审计** | "现在什么在跑,过去谁做了什么" | 基础指标 + 审计落磁盘 | 完整日志 + OTel + Webhook | SIEM 对接 + SLA 月报 + 异常检测 |
| ⑤ **运营与生态** | "如何对接 CI/CD / IaC / 告警" | CLI + Web UI + i18n | SDK(TS/Py/Go) + TF + Webhook | k8s Operator + 插件系统 + air-gap license |
| ⑥ **高可用与扩展** | "NSD 挂了怎么办,百万节点怎么扛" | 单实例 SQLite | active-active + Postgres + Redis | 跨区 NSD + SSE CDN + 多 NSD 并行产品化 |

## 2. 身份与组织(F1.x, 15 项)

来自 [11 · nsd-vision §①](../11-nsd-nsgw-vision/nsd-vision.md#身份与组织--功能清单):

| ID | 功能 | 落地级别 | 参考 |
| -- | ---- | -------- | ---- |
| F1.1 | Machine PKI 根 (X.509) | 企业级 | 当前 machinekey 无 CA 信任链 |
| F1.2 | 本地账号注册/登录 | MVP | `tmp/control/src/app/auth/login/` |
| F1.3 | OIDC SSO (Keycloak / Auth0 / Okta) | MVP (至少一种) | `tmp/control/src/lib/idp/oidcIdpProviderDefaults.ts` |
| F1.4 | SAML 2.0 | GA | XML 签名 + 证书管理 |
| F1.5 | SCIM 用户同步 (RFC 7644) | GA | 企业 HR 解雇即撤号 |
| F1.6 | 多租户 Organization | MVP (行级) / 企业级 (独立 DB) | `tmp/control/src/app/[orgId]/` |
| F1.7 | Realm (cloud shared / self-hosted) | MVP (self) / GA (shared) | 已有 realm 字段 |
| F1.8 | API Key 三层 (User / Org / Admin) | MVP (单层) / GA (三层) | `tmp/control/src/components/ApiKeysTable.tsx` |
| F1.9 | Service Account | GA | 机器注册自带身份 |
| F1.10 | 2FA / TOTP | MVP (可选) / GA (强制选项) | `tmp/control/src/app/auth/2fa/` |
| F1.11 | FIDO2 / WebAuthn | GA | 特权操作强制硬件密钥 |
| F1.12 | 邀请机制 | MVP | `tmp/control/src/components/InvitationsTable.tsx` |
| F1.13 | 审批工作流 | GA | `pending sites` 雏形 |
| F1.14 | Device Flow (RFC 8628) | ✅ MVP (mock 已有) | `auth.ts` `/api/v1/device/code` |
| F1.15 | 机器注册(含 quota) | ✅ MVP (已有) / GA (quota) | `POST /api/v1/machine/register` |

## 3. 策略与编排(F2.x, 15 项)

来自 [11 · nsd-vision §②](../11-nsd-nsgw-vision/nsd-vision.md#策略与编排--功能清单):

| ID | 功能 | 落地级别 | 备注 |
| -- | ---- | -------- | ---- |
| F2.1 | ACL 下发 (基础) | ✅ MVP | mock 未推 `acl_config`,生产需实现 |
| F2.2 | ACL 版本号 + 回滚 | GA | NSN 侧按版本缓存;NSD 一键回滚到 N-1 |
| F2.3 | 策略 DSL (类 Rego / CEL / HuJSON) | 企业级 | NSN 只见编译产物,不见 DSL |
| F2.4 | 策略测试工具 | GA | `nsdctl policy test --user alice --target ssh.site.n.ns` |
| F2.5 | 策略仿真 (historical replay) | 企业级 | 依赖 F4.4 完整连接日志 |
| F2.6 | 策略版本化 + 一键回滚 | GA | 5 秒回滚 |
| F2.7 | 策略灰度发布 (10% / 50% / 100%) | GA | hash(machine_id) % 10 分组 |
| F2.8 | 定时策略 (time-window) | 企业级 | "工作日 9-18 允许" |
| F2.9 | 条件策略 (Device Posture) | 企业级 | 需新 `POST /api/v1/machine/posture` |
| F2.10 | 策略审批 (2-person) | 企业级 | 高风险变更双人签 |
| F2.11 | 路由下发 + 优先级 | ✅ MVP (基础) / GA (priority) | `routing_config` 事件 |
| F2.12 | 服务发现 + 标签 | ✅ MVP (基础) / GA (labels) | `proxy_config` + `services.toml` |
| F2.13 | 条件 DNS (基于 location / group) | 企业级 | 依赖多区域 |
| F2.14 | Ingress 策略 (inbound) | GA | "只有 office_ip 能访问 prod" |
| F2.15 | Egress 策略 (outbound) | 企业级 | "exit-node 流量只到 *.company.com" |

**差异化主张**: NSIO 的 ACL 是"**仅允许**"模型,不是 tailscale 的 Accept/Reject 叠加。语义简单 + 审计友好 + 支持合并去重(`resource_id`)。

## 4. 网络编排(F3.x, 14 项)

来自 [11 · nsd-vision §③](../11-nsd-nsgw-vision/nsd-vision.md#网络编排--功能清单):

| ID | 功能 | 落地级别 |
| -- | ---- | -------- |
| F3.1 | Gateway 注册 + 区域标签 | ✅ MVP (基础) / GA (region) |
| F3.2 | NSN 就近选路 (latency + GeoIP) | ✅ MVP (已有) / GA (增强) |
| F3.3 | 站点分组 | GA |
| F3.4 | 用户分组 (group:devs → group:dev-sites) | MVP (基础) / GA (嵌套) |
| F3.5 | 跨站点直连 (Site-to-Site) | GA (via NSGW) / 企业级 (P2P) |
| F3.6 | Exit Node | GA |
| F3.7 | Subnet Router | GA |
| F3.8 | 拓扑编辑器 (可视化拖拽) | 企业级 |
| F3.9 | 流量工程 (按带宽 / 成本 / 延迟) | 企业级 |
| F3.10 | Site Provisioning Key | MVP |
| F3.11 | Blueprint (部署模板) | GA |
| F3.12 | 域名管理 + ACME 自动证书 | GA |
| F3.13 | Resource 管理 (CRUD + rules + auth) | MVP (基础) / GA (增强) |
| F3.14 | Share Link (临时访问,带过期) | GA |

## 5. 可观测与审计(F4.x, 13 项)

| ID | 功能 | 落地级别 | 参考 |
| -- | ---- | -------- | ---- |
| F4.1 | 实时设备列表 | MVP | Web UI + SSE |
| F4.2 | 连接拓扑图 (活跃路径 + bandwidth) | GA | 依赖 NSGW 上报 |
| F4.3 | 流量分析看板 | GA | `tmp/control/src/app/[orgId]/settings/logs/analytics/` |
| F4.4 | 连接日志 (4 层) | GA | ClickHouse / TimescaleDB |
| F4.5 | 请求日志 (7 层) | GA | HTTP Method/Path/Status/Latency |
| F4.6 | 访问日志 (ACL decision) | GA | 每个允许/拒绝带命中规则 |
| F4.7 | 审计日志 (Action log) | MVP (落盘) / GA (SIEM) | `requestAuditLog` 表 |
| F4.8 | 流式日志 (Live tail) | GA | Web UI SSE |
| F4.9 | 告警规则引擎 (Email / Slack / PagerDuty) | GA | "网关 X 下线 5 分钟" |
| F4.10 | SLA 月报 | 企业级 | uptime / p99 / failover count |
| F4.11 | OpenTelemetry 统一 | GA | NSN 已有,NSD/NSGW 需加 |
| F4.12 | 合规导出 (SIEM / SOC2) | 企业级 | Splunk HEC / Sentinel |
| F4.13 | 异常检测 (ML) | 企业级 (可选) | 流量 10x 突增预警 |

## 6. 运营与生态(F5.x, 18 项)

| ID | 功能 | 落地级别 |
| -- | ---- | -------- |
| F5.1 | Web UI 导航与布局 (shadcn/ui) | MVP |
| F5.2 | 深色模式 + i18n (10 种语言) | MVP (en+zh) / GA (全) |
| F5.3 | CLI `nsdctl` | MVP (基础 CRUD) / GA (完整覆盖) |
| F5.4 | OpenAPI spec 自动生成 | GA |
| F5.5-F5.7 | SDK (TypeScript / Python / Go) | GA |
| F5.8 | SDK (Rust) | 企业级 |
| F5.9 | Webhook + HMAC 签名 | GA |
| F5.10 | 事件总线 (Kafka / NATS) | 企业级 |
| F5.11 | Terraform Provider | GA |
| F5.12 | Kubernetes Operator (CRD: NsSite / NsUser / NsPolicy) | 企业级 |
| F5.13 | Billing / 计费 (Stripe 对接) | GA (SaaS) / 企业级 (离线) |
| F5.14 | License (离线,air-gap) | 企业级 |
| F5.15 | 插件系统 (Lua / WASM) | 企业级 |
| F5.16 | 初始设置向导 | MVP |
| F5.17 | 邮件 / SMS 通知 | MVP (邮件) / GA (SMS) |
| F5.18 | 组织级仪表盘 | MVP |

## 7. 高可用与扩展(F6.x, 12 项)

| ID | 功能 | 落地级别 |
| -- | ---- | -------- |
| F6.1 | 持久化存储 (SQLite / Postgres) | MVP (SQLite) / GA (Postgres) |
| F6.2 | NSD 多实例 active-active | GA |
| F6.3 | 跨区 NSD (multi-region control plane) | 企业级 |
| F6.4 | **多 NSD 并行 (NSIO 差异化)** | 企业级 · **独有卖点** |
| F6.5 | 读写分离 | 企业级 |
| F6.6 | Redis 缓存 | GA |
| F6.7 | NSD 热升级 (drain + swap) | GA |
| F6.8 | 备份 + PITR | GA |
| F6.9 | SSE 快照 CDN 化 | 企业级 |
| F6.10 | API 限流 (IP / API Key) | MVP (IP) / GA (Key) |
| F6.11 | IP 黑白名单 (admin 端点) | GA |
| F6.12 | Maintenance Mode 页 | MVP |

## 8. 控制面契约演进(跨组件)

来自 [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md)。除 mock 已有的 6 入 + 1 出 SSE,NSD 生产化需新增:

| 新契约 | 方向 | 用途 | 支撑能力 |
| ------ | ---- | ---- | -------- |
| `POST /api/v1/machine/posture` | NSN/NSC → NSD | 设备 posture 上报 (OS / 磁盘加密 / 2FA) | F2.9 条件策略 |
| `POST /api/v1/authz` | NSGW → NSD | 查询"此 user 对此 resource 能做什么" | G3.7 零信任策略点 |
| `POST /api/v1/billing/ingest` | NSGW → NSD | 上报 bytes / duration / connections | F5.13 计费 |
| `POST /api/v1/gateway/topology` | NSGW → NSD | 上报活跃 peer / session | F4.2 连接拓扑图 |
| `POST /api/v1/events` | Any → NSD | 通用事件上报 | F5.10 事件总线 |
| SSE `ca_bundle_update` | NSD → NSGW | 证书包更新 | F1.1 Machine PKI |
| SSE `quota_update` | NSD → NSGW | 每 org 配额更新 | G6.2 配额 |
| SSE `policy_version` | NSD → NSN/NSGW | 策略版本号 | F2.2 ACL 版本号 |
| SSE `gateway_drain` | NSD → NSN | "网关 X 即将下线"预告 | G4.2/G4.3 热升级 |
| `GET /api/v1/policy/simulate` | CLI / SDK → NSD | 策略仿真查询 | F2.5 策略仿真 |
| Webhook POST | NSD → 客户 | 事件外发 | F5.9 Webhook |

**兼容性原则**: ① 新增事件 / 字段 optional,不删旧类型;② register 时协商 `protocol_version: "2.0"`;③ 同时工作在 SSE / Noise / QUIC 三种传输上。

## 9. 分级落地 (MVP → GA → 企业级)

来自 [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md)。

### 9.1 Phase 1 · MVP (~2 季度)

**目标**: 10 个 NSN + 100 个 NSC 内部使用。

NSD 核心清单(节选):

- [ ] SQLite 持久化 + drizzle migration
- [ ] 把 mock 的 `addSubscriber` / `handleServicesReport` 迁生产栈,API 路径不变
- [ ] Web UI 框架 (Next.js + shadcn,参考 `tmp/control/src/components/ui/`)
- [ ] 初始设置向导 (参考 `tmp/control/src/app/setup/`)
- [ ] 本地账号 + OIDC SSO (至少 Keycloak + Authentik)
- [ ] 多租户 Org + Realm(self-hosted)
- [ ] User API Key(基础)
- [ ] 邀请链接
- [ ] 邮件发送(邀请 / 密码重置)
- [ ] 审计日志落本地
- [ ] i18n 启用(en + zh)
- [ ] 深色模式

**MVP 验收**: 单 NSD + 单 NSGW 跑 72 小时不崩;所有 4 套 E2E 测试(WG/WSS/Noise/QUIC)用生产 NSD 仍通过。

### 9.2 Phase 2 · GA (~4 季度)

**目标**: 100~1000 人企业客户,SLA 99.9%。

NSD 核心(节选):

- [ ] Postgres 支持 + NSD 多实例 active-active + Redis 缓存
- [ ] SAML 2.0 + SCIM + 审批工作流 + 2FA 强制选项
- [ ] Org API Key + 作用域
- [ ] 策略版本 + 灰度 + 测试工具(`nsdctl policy test`)
- [ ] Webhook + HMAC · Terraform Provider v1 · SDK(TS/Py/Go)
- [ ] 邮件 + Slack + PagerDuty 告警
- [ ] 审计日志 S3 导出 · 连接/请求/访问日志 · 流式日志 · OTel 统一
- [ ] API 限流 · IP 白名单 · 热升级 · 备份 + PITR
- [ ] Billing 基础 + Stripe 对接

**GA 验收**: 3 区 NSGW + 2 NSD active-active;1000 节点 p99 注册延迟 < 500ms;SAML + SCIM 对接 Okta / Azure AD / Google Workspace;TF apply 一键创建。

### 9.3 Phase 3 · 企业级 (~8 季度)

**目标**: 大型企业 / 金融 / 政府。

NSIO 差异化能力产品化:

- [ ] **多 NSD 并行**产品化 —— 联邦管理(CLI `nsdctl federation list` + Web UI 联邦视图 + 跨 NSD 审计关联 + 策略冲突检测)
- [ ] **协议可插拔数据面** —— 同 NSC 自动选 WG / QUIC / Noise
- [ ] **无 TUN 移动端 SDK** —— iOS / Android App 沙箱运行

NSD 企业级核心:

- [ ] Machine PKI (X.509) + BYO-CA + FIDO2 特权操作
- [ ] 策略 DSL (Rego / CEL) + 策略仿真 + 策略审批
- [ ] 定时策略 + 条件策略 (Posture) + Condition DNS + Ingress/Egress 策略
- [ ] 跨区 NSD + 读写分离 + SSE 快照 CDN 化
- [ ] 插件系统 + 离线 License + air-gap 部署
- [ ] SLA 月报 + 异常检测 + SIEM 深度对接 + SOC2 / ISO27001 对齐

**企业级验收**: 10 万节点 p99 注册延迟 < 1s;4 区跨大洲 NSGW,单区失效 30s 内 failover;策略 DSL 客户 security 团队可维护;合规审计满足 SOC2 + GDPR;air-gap 部署 license 跑通。

## 10. 跨阶段里程碑

| 里程碑 | 阶段 | 验收 |
| ------ | ---- | ---- |
| M1.0 Alpha | MVP 中期 | 3 节点 E2E + Web UI 登录 |
| M1.1 Beta | MVP 末 | 10 节点试点 + SLA 99.5% |
| M1.2 GA-candidate | MVP→GA | 100 节点压测 + SLA 99.9% |
| M2.0 GA | GA 末 | 1000 节点 + SaaS 上线 + Webhook/TF/SDK 齐 |
| M2.1 GA + Multi-region | GA+1Q | 3 区 + GeoDNS |
| M3.0 Enterprise Beta | 企业级 中 | 大客户试点 + Anycast + 策略 DSL |
| M3.1 Enterprise GA | 企业级 末 | air-gap + 合规认证 + 多 NSD 并行产品化 |

## 11. 运维形态(四档)

来自 [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md):

| 形态 | 目标规模 | NSD 部署 | 存储 | SLA |
| ---- | -------- | -------- | ---- | --- |
| **T0 · 单机 POC** | ≤ 5 人 | 单 Bun 进程 (mock) | 内存 | 无 |
| **T1 · 单区 MVP** | ≤ 1k 节点 | 2 实例 active-active + Nginx/Traefik | Postgres 主从 | 99.0% |
| **T2 · 多区 GA** | 1k-10k 节点 | 多区 active-active + Raft-like 共识 | Postgres Multi-AZ + PITR 7 天 | 99.9%;SOC2 Type II + ISO 27001 + GDPR 驻留 |
| **T3 · 跨云企业 / 私有化** | 万级节点 | 联邦(multi-NSD 并存)+ air-gap | Postgres + ETCD + 对象存储,三地五中心 | 99.99%;等保三级 / FedRAMP High / PCI-DSS / HIPAA |

## 12. 不在路线图内的事项

- **把 NSD 重写为 Rust**: 无需求驱动,`tmp/control/` (Next.js) 已提供完备 UI 框架。
- **把 NSD 控制面换成 gRPC**: SSE 对 DPI 友好,HTTP/1.1 over rustls 覆盖面广。
- **NSD 与数据面合并**: 有状态 vs 无状态的解耦是 NSIO 核心架构原则。
- **抛弃 Pangolin fork**: MVP 阶段成本太高,保留 fork 是 MVP 能在 2 季度交付的前提。

---

更详细的能力建模与分级落地见原章节:

- [11 · index](../11-nsd-nsgw-vision/index.md) · 愿景陈述与读者导航
- [11 · methodology](../11-nsd-nsgw-vision/methodology.md) · 能力建模 / 功能分级 / 竞品调研口径
- [11 · nsd-capability-model](../11-nsd-nsgw-vision/nsd-capability-model.md) · NSD 六大能力轴
- [11 · nsd-vision](../11-nsd-nsgw-vision/nsd-vision.md) · 87 项 NSD 功能 × 价值/挑战/落地级别
- [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md) · 跨组件控制面新契约
- [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) · 60+ 功能 × 7 列(当前/Sub-8/MVP/GA/企业/tailscale/headscale)
- [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md) · 四档运维形态 + SLA
- [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) · 分期交付 + 风险
