# NSD 功能预测 · 生产化愿景

> **读者**: NSD owner、架构师、PM。
>
> **目标**: 在 [nsd-capability-model.md](./nsd-capability-model.md) 的六条能力轴下,逐项给出具体功能预测。每项功能都包含:**价值(为什么要做) / 用户故事 / 技术挑战 / 架构影响 / 落地级别(MVP/GA/企业)**。

本章 50+ 项功能。读者可以按需跳读,也可以配合 [feature-matrix.md](./feature-matrix.md) 查表。

---

## ① 身份与组织 · 功能清单

[NSD 身份与组织功能图](./diagrams/nsd-identity-org-map.d2)

### F1.1 机器身份 PKI 根 (Machine PKI)

- **价值**: 当前 machinekey 是"第一次注册时上传"的 Ed25519,没有 CA 信任链。企业需要**能吊销 + 能批量轮换 + 硬件绑定**的机制。
- **用户故事**: "我是一家金融公司的安全工程师,需要在笔记本 TPM 里生成 machinekey 并让 NSD 验签时要求 TPM attestation"。
- **技术挑战**: 与 `crates/control/src/noise_transport.rs`、`quic_transport.rs` 现有的静态 pubkey 兼容;引入 CA 需要不破坏 device flow。
- **架构影响**: 新增 `certificates` 表与 `revocation` 表;SSE 加 `ca_bundle_update` 事件。
- **落地级别**: 企业级 (MVP 阶段 继续用 pubkey 直存)。

### F1.2 用户身份: 本地账号

- **价值**: MVP 必须能脱离外部 IdP 运转,供 POC / 小团队使用。
- **参考**: `tmp/control/src/app/auth/login/` + `tmp/control/src/components/LoginForm.tsx` + `tmp/control/src/components/SignupForm.tsx`。
- **落地级别**: MVP。

### F1.3 用户身份: OIDC

- **价值**: 让企业用已有的 IdP (Keycloak / Auth0 / Okta / Azure AD) 登录。
- **参考**: `tmp/control/src/app/[orgId]/settings/(private)/idp/create/page.tsx`, `tmp/control/src/lib/idp/oidcIdpProviderDefaults.ts`, `tmp/control/src/app/auth/idp/`。
- **技术挑战**: role mapping (IdP group → NSD role),见 `tmp/control/src/components/RoleMappingConfigFields.tsx`。
- **落地级别**: MVP (至少一种 OIDC),GA 必须完善。

### F1.4 用户身份: SAML 2.0

- **价值**: 大企业仍大量使用 SAML。
- **技术挑战**: 需要 XML 签名验证 + 证书管理;Pangolin fork 看起来只覆盖 OIDC (`tmp/control/src/lib/idp/` 只有 oidc defaults),SAML 要新加。
- **落地级别**: GA。

### F1.5 SCIM 用户同步

- **价值**: 企业 HR 系统解雇员工时,自动撤销 NSD 账号。
- **技术挑战**: SCIM 2.0 协议实现 (RFC 7644),入站 POST `/scim/v2/Users`。
- **落地级别**: GA。

### F1.6 多租户组织 (Organization)

- **价值**: SaaS 部署场景下,一个 NSD 实例服务多个客户组织,数据严格隔离。
- **参考**: `tmp/control/src/app/[orgId]/` 路由以 `orgId` 为根,所有资源都有 `orgId` 外键。
- **技术挑战**: 行级隔离策略 (RLS) vs 独立 schema vs 独立 DB 三选一;Pangolin 参考用的是**行级 orgId 过滤**。
- **落地级别**: MVP (行级),企业级(独立 DB 可选)。

### F1.7 Realm (shared / self-hosted)

- **价值**: NSIO 独有概念,一个 NSD 可以同时承载"共享 realm"(多租户共享)和"自建 realm"(客户独占)。
- **参考**: mock types.ts 的 realm 字段 (`tests/docker/nsd-mock/src/types.ts:1-266`)。
- **落地级别**: MVP 支持 self-hosted realm;GA 加 shared realm。

### F1.8 API Key (三层)

- **价值**: 自动化脚本访问 NSD API 的凭证。参考实现已区分 user / org / admin 三层 (`tmp/control/src/app/[orgId]/settings/api-keys/`, `tmp/control/src/app/admin/api-keys/`)。
- **技术挑战**: 权限作用域 (scope) 设计;key 前缀 (nsd_pat_ / nsd_sk_) 便于扫描检测。
- **落地级别**: MVP (单层),GA (三层)。

### F1.9 Service Account

- **价值**: 机器注册时提供自己的身份,不用共享用户凭证。
- **落地级别**: GA。

### F1.10 2FA / TOTP

- **参考**: `tmp/control/src/app/auth/2fa/`, `tmp/control/src/components/TwoFactorSetupForm.tsx`。
- **落地级别**: MVP (可选),GA (强制选项可配)。

### F1.11 FIDO2 / WebAuthn (硬件密钥)

- **参考**: `tmp/control/src/components/SecurityKeyAuthButton.tsx`, `SecurityKeyForm.tsx`。
- **价值**: 特权操作 (撤销 site / 轮换 ca / 批量删用户) 必须用硬件密钥。
- **落地级别**: GA。

### F1.12 邀请机制

- **参考**: `tmp/control/src/app/[orgId]/settings/access/invitations/`, `tmp/control/src/components/InvitationsTable.tsx`。
- **落地级别**: MVP。

### F1.13 审批工作流 (Approval)

- **参考**: `tmp/control/src/app/[orgId]/settings/(private)/access/approvals/`, `tmp/control/src/components/ApprovalFeed.tsx`。
- **价值**: 加入 org 或注册新 site 需要管理员审批。
- **参考现有雏形**: `tmp/control/src/app/[orgId]/settings/provisioning/pending/` —— 等待审批的 site 列表。
- **落地级别**: GA。

### F1.14 Device Flow (RFC 8628)

- **价值**: NSC 在没有浏览器的环境 (服务器 / CI runner) 上完成登录。
- **现状**: ✅ mock 已实现 `POST /api/v1/device/code` + `POST /api/v1/device/token` (见 `tests/docker/nsd-mock/src/auth.ts`)。
- **技术挑战**: 将 mock 的逻辑迁到生产 NSD,保留相同 API 路径。
- **落地级别**: MVP (已有)。

### F1.15 机器注册 (Machine Register)

- **现状**: ✅ mock `POST /api/v1/machine/register` (auth.ts)。
- **扩展**: 注册时强制 2FA 或审批;注册 quota (每个 org 最多 N 台)。
- **落地级别**: MVP (已有),GA (quota)。

---

## ② 策略与编排 · 功能清单

### F2.1 ACL 下发 (基础)

- **现状**: ✅ SSE `acl_config` 事件;NSN 侧 `crates/acl/` 是"仅允许"模型。
- **落地级别**: MVP。

### F2.2 ACL 版本号

- **价值**: 当前 SSE 每次全量推送 ACL,无法 diff 也无法回滚。加 `acl_version` 后 NSN 可以记录当前版本,NSD 可以一键回滚到 N-1。
- **技术挑战**: NSN 侧 `crates/control/src/merge.rs` 要兼容"带版本的" config 与旧 config 混用。
- **落地级别**: GA。

### F2.3 策略 DSL (Policy DSL)

- **价值**: 目前 ACL 是 JSON 硬编码,管理员要手写。DSL 让运营者用类似代码的语法表达策略。
- **候选语法**: OPA Rego、CEL、自研 (类似 ZeroTier flow rules)。
- **用户故事**: "allow user:alice to access site:prod-db via gateway:us-east if device has 2fa AND time in work_hours"。
- **技术挑战**: 编译到内部表示 + 执行引擎;与现有 `acl_config` 事件兼容 (DSL 编译产物就是现有 JSON)。
- **落地级别**: 企业级。

### F2.4 策略测试工具

- **用户故事**: 管理员修改策略前,用 `nsdctl policy test --user alice --target ssh.siteA.n.ns` 预览会被允许还是拒绝。
- **落地级别**: GA。

### F2.5 策略仿真 (Simulation)

- **价值**: 上一项的加强版 —— 不是逐个请求测试,而是"用过去 7 天的真实流量重放",看新策略下会拒绝多少正常流量。
- **依赖**: 需要先有完整连接日志 (见 F4.4)。
- **落地级别**: 企业级。

### F2.6 策略版本化 + 一键回滚

- **价值**: 每次策略变更带 version 号,出问题 5 秒回滚。
- **落地级别**: GA。

### F2.7 策略灰度发布

- **价值**: 新策略先推 10% 设备,观察无异常后 50% 再 100%。
- **技术挑战**: 设备子集划分 (hash of machine_id % 10);NSD 侧记录每个设备收到的版本。
- **落地级别**: GA。

### F2.8 定时策略

- **价值**: "工作日 9-18 才允许开发访问生产"。
- **落地级别**: 企业级。

### F2.9 条件策略 (Device Posture)

- **价值**: 基于设备状态决定访问权限 —— OS 版本 / 磁盘加密 / 企业杀毒软件在线。
- **技术挑战**: NSN/NSC 要上报 posture 字段 (新 `/api/v1/machine/posture` 端点)。
- **落地级别**: 企业级。

### F2.10 策略审批工作流

- **价值**: 高风险变更 (删除 org / 撤销大量 site / 允许 all → all) 需要 2 人审批。
- **落地级别**: 企业级。

### F2.11 路由下发 + 优先级

- **现状**: ✅ `routing_config` 事件,NSGW 的 traefik 按接收顺序应用。
- **扩展**: 引入 priority 字段;多规则冲突时取 priority 更高的。
- **落地级别**: GA。

### F2.12 服务发现 + 标签

- **现状**: ✅ `proxy_config` + `services.toml` (NSN 侧严格白名单)。
- **扩展**: 服务加 labels (`env=prod`, `tier=db`),策略可基于标签匹配。
- **落地级别**: GA。

### F2.13 条件 DNS 下发

- **价值**: 同一个 `.n.ns` 域名,对欧洲客户解析到欧洲 NSGW,对亚洲客户解析到亚洲 NSGW。
- **依赖**: 网络编排轴的"多区域"。
- **落地级别**: 企业级。

### F2.14 Ingress 策略 (inbound)

- **价值**: 管理员可以限定"只有来自 office_ip_range 的客户端能访问 prod"。
- **落地级别**: GA。

### F2.15 Egress 策略 (outbound)

- **价值**: "这台 NSN 的 exit-node 流量只能发到 *.company.com"。
- **落地级别**: 企业级。

---

## ③ 网络编排 · 功能清单

### F3.1 Gateway 注册 + 区域标签

- **现状**: ✅ `POST /api/v1/gateway/report` (mock `tests/docker/nsd-mock/src/index.ts:93-100`)。
- **扩展**: gateway 报告中加 `region` / `zone` / `tier` 字段,NSD 记录后下发给 NSN 用于选路。
- **落地级别**: MVP (基础注册已有),GA (region 字段)。

### F3.2 NSN 就近选路

- **现状**: ✅ `crates/connector/` 的 `MultiGatewayManager`,已有多网关选路逻辑。
- **扩展**: 加 latency 探测和 GeoIP 距离权重。
- **落地级别**: GA。

### F3.3 站点分组

- **价值**: "这三个 NSN 是 prod 集群""这五个是 dev 实验室",策略按组下发。
- **落地级别**: GA。

### F3.4 用户分组

- **价值**: 与站点分组对称,用户也能分组;策略写 "group:devs → group:dev-sites"。
- **落地级别**: MVP (基础 group),GA (嵌套 / 继承)。

### F3.5 跨站点直连 (Site-to-Site)

- **价值**: site A 的 NSN 直接访问 site B 的 NSN,不经过网关中继。
- **技术挑战**: NAT 穿透 + P2P (见 [data-plane-extensions.md](./data-plane-extensions.md))。
- **落地级别**: GA (通过 NSGW 中转),企业级 (真正 P2P)。

### F3.6 Exit Node (出口节点)

- **参考**: `tmp/control/src/app/[orgId]/settings/(private)/remote-exit-nodes/`, `tmp/control/src/components/ExitNodesTable.tsx`, `ExitNodeInfoCard.tsx`。
- **价值**: 用户可以"从 NSN 所在网络出公网",类似 tailscale exit-node。
- **落地级别**: GA。

### F3.7 Subnet Router

- **价值**: 一个 NSN 代表整个 LAN,其他 LAN 设备免客户端。
- **落地级别**: GA。

### F3.8 拓扑编辑器 (可视化)

- **价值**: 用户在 Web UI 上拖拽 gateway / site / user group,自动生成路由规则。
- **落地级别**: 企业级。

### F3.9 流量工程

- **价值**: 按带宽 / 成本 / 延迟在多条路径之间选择。
- **落地级别**: 企业级。

### F3.10 Site Provisioning Key

- **参考**: `tmp/control/src/app/[orgId]/settings/provisioning/keys/`, `tmp/control/src/components/CreateSiteProvisioningKeyCredenza.tsx`。
- **价值**: 批量部署 NSN 时,预生成一个 key,在 installer 里自动注册。
- **落地级别**: MVP。

### F3.11 Blueprint (部署模板)

- **参考**: `tmp/control/src/app/[orgId]/settings/blueprints/`, `tmp/control/src/components/CreateBlueprintForm.tsx`, `BlueprintDetailsForm.tsx`。
- **价值**: 把"一个 site + 3 个 resource + 2 条 acl"打包成模板,新建类似站点一键套用。
- **落地级别**: GA。

### F3.12 域名管理

- **参考**: `tmp/control/src/app/[orgId]/settings/domains/`, `tmp/control/src/components/DomainsTable.tsx`, `DomainCertForm.tsx`, `CertificateStatus.tsx`, `RestartDomainButton.tsx`。
- **价值**: 自定义域名挂 NSGW 反代,自动 ACME 证书。
- **落地级别**: GA。

### F3.13 Resource 管理

- **参考**: `tmp/control/src/app/[orgId]/settings/resources/` 下分 `client/` 和 `proxy/`,每个 resource 可配 `rules`, `authentication`, `proxy` 子页。
- **价值**: 把"访问目标"抽象成资源,策略和监控都围绕资源展开。
- **落地级别**: MVP (基础 CRUD),GA (rules + authentication)。

### F3.14 Share Link (临时访问)

- **参考**: `tmp/control/src/app/[orgId]/settings/share-links/`, `tmp/control/src/app/s/[accessToken]/page.tsx`, `tmp/control/src/components/CreateShareLinkForm.tsx`。
- **价值**: 给外部人员发一个带过期时间的链接,点开即可访问某个内部资源。
- **落地级别**: GA。

---

## ④ 可观测与审计 · 功能清单

### F4.1 实时设备列表

- **价值**: Web UI 能看全量 NSN/NSGW/NSC,在线离线、最后心跳。
- **落地级别**: MVP。

### F4.2 连接拓扑图

- **价值**: 可视化 "client → gateway → site" 活跃路径,带 bandwidth。
- **依赖**: 需要 NSGW 上报连接状态 (见 [nsgw-vision.md](./nsgw-vision.md) 的观测轴)。
- **落地级别**: GA。

### F4.3 流量分析看板

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/analytics/`, `tmp/control/src/components/LogAnalyticsData.tsx`。
- **价值**: 按日/周聚合,Top N 源/目的/协议。
- **落地级别**: GA。

### F4.4 连接日志 (4 层)

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/connection/`。
- **价值**: 每个 TCP/UDP 会话 (src/dst/bytes/duration/retransmits)。
- **技术挑战**: 数据量巨大,需要 ClickHouse / TimescaleDB;需要 NSGW 采样上报。
- **落地级别**: GA。

### F4.5 请求日志 (7 层)

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/request/`。
- **价值**: HTTP 层 (Method/Path/Status/Latency/User-Agent)。
- **落地级别**: GA。

### F4.6 访问日志 (ACL decision)

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/access/`。
- **价值**: 每个被 ACL 拦截/允许的请求,带匹配到的规则。
- **落地级别**: GA。

### F4.7 审计日志 (Action log)

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/action/`。
- **价值**: 谁在什么时候做了什么管理操作 (登录 / 改策略 / 加用户)。
- **落地级别**: MVP (基础落磁盘),GA (导出 SIEM)。

### F4.8 流式日志 (Live tail)

- **参考**: `tmp/control/src/app/[orgId]/settings/logs/streaming/`。
- **价值**: Web UI 上实时跟踪日志尾巴,排障用。
- **落地级别**: GA。

### F4.9 告警规则引擎

- **价值**: "网关 X 下线超过 5 分钟" → 发邮件 / Slack / PagerDuty。
- **落地级别**: GA。

### F4.10 SLA 月报

- **价值**: 月度出具 uptime / p99 latency / failover count 报告,给客户合规审计用。
- **落地级别**: 企业级。

### F4.11 OpenTelemetry 统一

- **现状**: NSN 侧有 `crates/telemetry/` 输出 traces + metrics。
- **扩展**: NSD/NSGW 也输出,通过 trace_id 关联。
- **落地级别**: GA。

### F4.12 合规导出 (SIEM / SOC2)

- **价值**: 审计日志导出 Splunk / Elastic / Datadog 的 HEC / 内部 SIEM。
- **落地级别**: 企业级。

### F4.13 异常检测 (ML)

- **价值**: "这个用户今晚比平时多访问了 10 倍的 site X" → 预警。
- **落地级别**: 企业级 (可选)。

---

## ⑤ 运营与生态 · 功能清单

### F5.1 Web UI: 导航与布局

- **参考**: `tmp/control/src/components/Layout.tsx`, `LayoutHeader.tsx`, `LayoutSidebar.tsx`, `SidebarNav.tsx`, `LayoutMobileMenu.tsx`, `TopbarNav.tsx`。
- **落地级别**: MVP。

### F5.2 Web UI: 深色模式 + i18n

- **参考**: `tmp/control/src/components/ThemeSwitcher.tsx`, `LocaleSwitcher.tsx`,`tmp/control/messages/` 已有 16 种语言。
- **落地级别**: MVP (英文+中文),GA (全 16 语言)。

### F5.3 CLI (`nsdctl`)

- **参考现有雏形**: `tmp/control/cli/commands/` 有 7 条 admin 命令 (clearExitNodes / clearLicenseKeys / deleteClient / generateOrgCaKeys / resetUserSecurityKeys / rotateServerSecret / setAdminCredentials)。
- **扩展目标**: 覆盖所有 REST API 资源 (`nsdctl site list`, `nsdctl user add`, `nsdctl policy apply -f policy.json`)。
- **落地级别**: MVP (基础 CRUD),GA (完整覆盖)。

### F5.4 OpenAPI spec

- **价值**: 自动生成 API 文档 + 客户端 SDK。
- **落地级别**: GA。

### F5.5 SDK: TypeScript

- **落地级别**: GA。

### F5.6 SDK: Python

- **落地级别**: GA。

### F5.7 SDK: Go

- **落地级别**: GA。

### F5.8 SDK: Rust

- **价值**: NSN/NSC 本身用 Rust,官方 SDK 方便下游集成。
- **落地级别**: 企业级。

### F5.9 Webhook

- **价值**: 事件触发 (site.joined / policy.changed / gateway.down) POST 到客户 URL。
- **技术挑战**: 签名 (HMAC) + 重试 + 幂等。
- **落地级别**: GA。

### F5.10 事件总线 (internal + external)

- **价值**: 内部 Kafka/NATS,外部 consumer 订阅;Webhook 是其表层。
- **落地级别**: 企业级。

### F5.11 Terraform Provider

- **价值**: IaC 定义 site / user / policy / gateway。
- **落地级别**: GA。

### F5.12 Kubernetes Operator

- **价值**: 在 k8s 内用 CRD 声明式管理 NSIO 资源。
- **落地级别**: 企业级。

### F5.13 Billing / 计费

- **参考**: `tmp/control/src/app/[orgId]/settings/(private)/billing/`, `tmp/control/src/components/SitePriceCalculator.tsx`, `NewPricingLicenseForm.tsx`, `PaidFeaturesAlert.tsx`, `SubscriptionViolation.tsx`, `SupporterMessage.tsx`, `SupporterStatus.tsx`。
- **价值**: 按带宽 / 按活跃设备 / 按策略数量计费;对接 Stripe / 企业发票。
- **落地级别**: GA (SaaS 部署),企业级 (离线 license 见 F5.14)。

### F5.14 License (离线)

- **参考**: `tmp/control/src/app/[orgId]/settings/(private)/license/`, `tmp/control/src/app/admin/license/`, `tmp/control/src/components/GenerateLicenseKeyForm.tsx`, `LicenseViolation.tsx`。
- **价值**: air-gap 部署场景,用离线 license 激活功能。
- **落地级别**: 企业级。

### F5.15 插件系统

- **价值**: NSD 暴露 hook 点 (pre-register / post-register / policy-filter),允许第三方 Lua/WASM 插件。
- **落地级别**: 企业级。

### F5.16 初始设置向导

- **参考**: `tmp/control/src/app/setup/page.tsx`, `tmp/control/src/app/auth/initial-setup/`。
- **价值**: 首次启动时引导创建 admin / 配置 IdP / 创建第一个 org。
- **落地级别**: MVP。

### F5.17 邮件 / SMS 通知

- **价值**: 邀请邮件、密码重置、告警通知。
- **落地级别**: MVP (邮件),GA (SMS)。

### F5.18 组织级仪表盘

- **参考**: `tmp/control/src/components/OrganizationLandingCard.tsx`, `OrganizationLanding.tsx`, `OrgInfoCard.tsx`。
- **落地级别**: MVP。

---

## ⑥ 高可用与扩展 · 功能清单

### F6.1 持久化存储 (SQLite / Postgres)

- **参考**: `tmp/control/drizzle.sqlite.config.ts`, `drizzle.pg.config.ts` (同时支持 SQLite 和 Postgres)。
- **落地级别**: MVP (SQLite),GA (Postgres)。

### F6.2 NSD 多实例 (active-active)

- **价值**: 3 个 NSD 实例共享 Postgres,任一挂掉不影响。
- **技术挑战**: SSE 订阅要 sticky 到某一实例 (subscriber 表外置 Redis);`addSubscriber` (mock 的 `registry.ts`) 当前是进程内 Map,要改造。
- **落地级别**: GA。

### F6.3 跨区 NSD (multi-region control plane)

- **价值**: 美国挂了欧洲继续工作。
- **落地级别**: 企业级。

### F6.4 多 NSD 并行 (差异化)

- **现状**: ✅ NSN 侧已支持 `crates/control/src/multi.rs` (`MultiControlPlane`),按 `resource_id` 合并 (`crates/control/src/merge.rs:63`)。
- **扩展**: NSD 侧要支持"给 NSN 吐一个 NSD 列表让它同时连"(注册时协商)。
- **落地级别**: 企业级 (NSIO 独有卖点)。

### F6.5 读写分离

- **落地级别**: 企业级。

### F6.6 Redis 缓存

- **价值**: 高频读的 machine registry / policy 放 Redis。
- **落地级别**: GA。

### F6.7 NSD 热升级

- **价值**: 滚动升级不断 SSE;老进程 drain 现有连接,新进程接新连接。
- **技术挑战**: SSE 长连迁移;Bun 原生不支持 SO_REUSEPORT socket handoff,要用 nginx / envoy 做前置。
- **落地级别**: GA。

### F6.8 备份 + PITR

- **落地级别**: GA。

### F6.9 SSE 快照 CDN 化

- **价值**: 首次订阅时下发的 snapshot 可以放 CDN (S3 + CloudFront),减轻 NSD 压力。
- **落地级别**: 企业级。

### F6.10 API 限流

- **价值**: 防止注册 / 策略变更端点被刷爆。
- **落地级别**: MVP (基础 IP 限流),GA (API Key 维度)。

### F6.11 IP 黑白名单

- **价值**: 企业场景只允许办公 IP 访问 admin 端点。
- **落地级别**: GA。

### F6.12 Maintenance Mode

- **参考**: `tmp/control/src/app/maintenance-screen/page.tsx`。
- **价值**: 升级期间给用户友好提示。
- **落地级别**: MVP。

---

## 生产化架构全景

[NSD 生产化架构全景](./diagrams/nsd-production-architecture.d2)

完整版本见 [diagrams/nsd-vision-arch.d2](./diagrams/nsd-vision-arch.d2)。

## 功能数量自检

- 身份与组织: 15 项
- 策略与编排: 15 项
- 网络编排: 14 项
- 可观测与审计: 13 项
- 运营与生态: 18 项
- 高可用与扩展: 12 项

**合计 87 项 NSD 功能**,横向对比见 [feature-matrix.md](./feature-matrix.md)。

下一章 → [nsgw-capability-model.md](./nsgw-capability-model.md)
