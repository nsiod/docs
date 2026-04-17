# 路线图 (Roadmap)

> **读者**: PM / 工程负责人 / 管理层。
>
| 注意: 本文档的"季度"是**相对节奏**,不对应绝对日历。真实排期要在立项评审时锚定。

## 四个阶段

[NSIO NSD+NSGW 生产化路线图 (相对季度)](./diagrams/roadmap-phases.d2)

完整 d2 源: [diagrams/roadmap.d2](./diagrams/roadmap.d2)。

---

## Phase 0 — 当前 (已达成)

✅ Rust 数据面 12 crate 完整
✅ NSD mock 跑通 4 套 E2E (WG/WSS/Noise/QUIC)
✅ NSGW mock 跑通 traefik + WG peer 动态
✅ 多控制面并发 (NSN 侧)
✅ `tmp/control/` 参考工程齐备 (来源 Pangolin,含多租户/RBAC/IdP/billing/blueprint)
✅ `tmp/gateway/` 参考工程齐备 (来源 gerbil,含 SNI/UDP relay/hole punch)

---

## Phase 1 — MVP (~2 季度)

### 目标

交付一个**能被内部 10 个 NSN 节点 + 100 个 NSC 客户端使用**的生产版本。能跑 E2E、能落库、能管理、能审计。

### M1 里程碑清单

#### 控制面 (NSD 生产化)

- [ ] 持久化: SQLite (单实例) / Drizzle ORM,参考 `tmp/control/drizzle.sqlite.config.ts`
- [ ] 把 mock 的 `addSubscriber` / `handleServicesReport` 等逻辑迁到生产栈,保留 API 路径不变
- [ ] Web UI 框架搭建 (Next.js + shadcn,参考 `tmp/control/src/components/ui/`)
- [ ] 初始设置向导 (参考 `tmp/control/src/app/setup/`)
- [ ] 本地用户注册/登录 (参考 `tmp/control/src/app/auth/login/`)
- [ ] OIDC SSO (至少 Keycloak + Authentik,参考 `tmp/control/src/lib/idp/oidcIdpProviderDefaults.ts`)
- [ ] 多租户 Org (参考 `[orgId]` 路由)
- [ ] Realm (self-hosted) 加载
- [ ] User API Key (基础)
- [ ] 邀请链接机制
- [ ] 组织仪表盘
- [ ] 邮件发送 (邀请 / 密码重置)
- [ ] Maintenance mode 页
- [ ] 审计日志落本地 (参考 logs/action)
- [ ] i18n 启用 (en + zh,参考 `tmp/control/messages/`)
- [ ] 深色模式 (参考 ThemeSwitcher)

#### 网关 (NSGW 生产化)

- [ ] 基于 `tmp/gateway/` Go 代码,对接 NSIO 的 NSD SSE 契约
- [ ] 替换 gerbil 的 `/gerbil/get-config` REST 轮询为 NSD `/api/v1/config/stream` SSE
- [ ] 保留 SNI proxy / WG kernel / PROXY v1 / 内存 watchdog
- [ ] traefik 动态路由集成 (仿 mock `handleRoutingConfig`)
- [ ] `/healthz` + `/ready` 标准化
- [ ] Prometheus `/metrics` 导出
- [ ] 加入 NSD "gateway_report" 流程

#### 跨组件

- [ ] Provisioning Key 流程跑通 (参考 Pangolin `tmp/control/src/app/[orgId]/settings/provisioning/`)
- [ ] Device Flow 保留 (mock 已有)
- [ ] CLI `nsdctl` v0.1: site list/create, user add, policy apply,覆盖 20 条基本命令
- [ ] 继承 `tmp/control/cli/commands/` 的 7 条 admin 破坏性操作

### MVP 验收标准

- 单 NSD + 单 NSGW 跑 72 小时不崩
- 10 个 NSN + 100 个 NSC 能注册 / 建隧道 / 互通
- 审计日志能查到所有管理操作
- 日常 CRUD 操作能在 Web UI / CLI 两个入口完成
- OIDC 登录能对接 Keycloak
- 所有 4 套 E2E 测试 (WG/WSS/Noise/QUIC) 用生产 NSD/NSGW 而非 mock 仍通过

### MVP 依赖前置

| 依赖 | 状态 |
|------|------|
| Rust 数据面稳定 | ✅ 已有 |
| `tmp/control/` 可二次开发 | ✅ 已有 (Pangolin fork) |
| `tmp/gateway/` 可二次开发 | ✅ 已有 (gerbil fork) |
| mock 的 API 契约可作为权威 | ✅ 已在 docs/08-nsd-control/ 固化 |

### MVP 风险

| 风险 | 应对 |
|------|------|
| 从 mock 迁生产时 API 漂移 | 契约测试(E2E 全套重跑) |
| Next.js 版本与 NSIO 栈其他部分不兼容 | 独立部署 |
| gerbil 的 config 拉取模型与 NSIO SSE 推送不一致 | 先做 adapter 层,不直接改 gerbil |
| Pangolin fork 带来的 GPL/AGPL 法律风险 | 尽早审查 license,必要时重写关键模块 |

---

## Phase 2 — GA (~4 季度)

### 目标

**卖给 100~1000 人企业客户,有 SLA 99.9%**。

### M2 里程碑清单

#### 控制面 (NSD GA)

- [ ] Postgres 支持 (参考 `tmp/control/drizzle.pg.config.ts`)
- [ ] NSD 多实例 active-active,共享 Postgres + Redis
- [ ] SAML 2.0 SSO
- [ ] SCIM 用户同步
- [ ] 审批工作流 (参考 approvals/ + pending sites)
- [ ] 2FA 强制选项
- [ ] Org API Key + 作用域
- [ ] 策略版本号 + 一键回滚
- [ ] 策略灰度发布 (按 10%/50%/100%)
- [ ] 策略测试工具 (`nsdctl policy test`)
- [ ] Webhook + HMAC 签名
- [ ] Terraform Provider v1
- [ ] SDK TypeScript + Python + Go
- [ ] 邮件 + Slack + PagerDuty 告警通道
- [ ] 审计日志 S3 导出
- [ ] 连接日志 + 请求日志 + 访问日志 (参考 Pangolin logs/*)
- [ ] 流量分析看板
- [ ] 流式日志 (SSE 到 Web UI)
- [ ] OpenTelemetry 统一
- [ ] API 限流 (IP + API Key 双维度)
- [ ] IP 白名单 (admin 端点)
- [ ] NSD 热升级 (drain → swap)
- [ ] 备份 + PITR
- [ ] Redis 缓存层
- [ ] Billing 基础 (带宽 / 设备数) + Stripe 对接

#### 网关 (NSGW GA)

- [ ] QUIC 数据面
- [ ] 内置 STUN + NSD-coordinated hole punch (P2P)
- [ ] PROXY Protocol v2
- [ ] mTLS 终结
- [ ] 多区域部署 (至少 3 区) + GeoDNS
- [ ] 热升级 (drain + swap)
- [ ] 蓝绿部署
- [ ] 基础限速 + UDP flood 防御
- [ ] CrowdSec 对接 (IP 信誉)
- [ ] WAF 基础 (Coraza)
- [ ] Resource 级认证 (password / pin)
- [ ] 实时拓扑上报到 NSD
- [ ] 每 peer 带宽计量
- [ ] 每 org 配额
- [ ] 计费埋点 → NSD
- [ ] WSS 背压
- [ ] 连接数上限 (per IP / per user)
- [ ] Prometheus metrics 完整
- [ ] 连接级日志
- [ ] 配置回滚机制
- [ ] 自愈 (systemd / k8s liveness)

#### 跨组件

- [ ] NSN 多网关选路加 latency 探测 + GeoIP 权重
- [ ] Exit Node (参考 Pangolin 雏形)
- [ ] Subnet Router
- [ ] Blueprint 模板 (参考 Pangolin)
- [ ] 域名管理 + ACME 自动证书
- [ ] Share Link (参考 Pangolin)
- [ ] Path-based / Header-based routing
- [ ] WG+WSS 双活 (failover,不聚合)
- [ ] BBR 可选 (WSS 模式)
- [ ] 私有 DNS 拼接

### GA 验收标准

- 3 区 NSGW 部署,客户端基于 GeoDNS 就近
- 2 台 NSD active-active,任一挂掉不影响
- 1000 节点规模下 p99 注册延迟 < 500ms
- SAML + SCIM 能对接 Okta / Azure AD / Google Workspace
- Terraform apply 一键创建完整环境
- Webhook 在事件发生 30 秒内到达客户
- 审计日志能导出到 Splunk / Elastic
- 所有 MVP E2E + 新增 GA 用例通过

### GA 风险

| 风险 | 应对 |
|------|------|
| 多实例 NSD 的 SSE subscriber 分发(一个 NSN 同时连多实例?) | 外置 Redis 做 subscriber registry;或走负载均衡 sticky |
| P2P 打洞在复杂 NAT 下成功率低 | 保留 WSS 中继兜底;打洞成功率持续监控 |
| 多区域 NSGW 之间状态同步 | 无共享状态原则;所有状态走 NSD |
| Terraform Provider 与 Web UI 状态漂移 | 提供 `data "nsio_*"` 数据源 |

---

## Phase 3 — 企业级 (~8 季度)

### 目标

**销售给大型企业 / 金融 / 政府,满足合规 / 私有化 / 定制化需求**。

### M3 里程碑清单

#### 差异化能力 (NSIO 独有)

- [ ] **多 NSD 并行**产品化 —— NSD 互不感知但联邦管理
  - CLI `nsdctl federation list` 能看到其他 NSD
  - Web UI "联邦视图" 同时展示多 NSD 数据
  - 审计日志跨 NSD 关联
  - 策略冲突检测与可视化
- [ ] **协议可插拔数据面** —— 同一 NSC 能按策略自动选 WG / QUIC / Noise
- [ ] **无 TUN 移动端 SDK** —— iOS / Android 在普通 App 沙箱内运行

#### 控制面 (NSD 企业级)

- [ ] 机器身份 X.509 根证书 (Machine PKI)
- [ ] BYO-CA 支持
- [ ] FIDO2 / WebAuthn 特权操作
- [ ] 策略 DSL (Rego 或 CEL)
- [ ] 策略仿真 (历史流量重放)
- [ ] 策略审批 (2-person)
- [ ] 定时策略 + 条件策略 (Posture)
- [ ] Condition DNS
- [ ] Ingress + Egress 策略
- [ ] 跨区 NSD (multi-region control plane)
- [ ] 读写分离
- [ ] SSE 快照 CDN 化
- [ ] 插件系统 (Lua / WASM)
- [ ] 离线 License + air-gap 部署
- [ ] SLA 月报
- [ ] 异常检测 (可选 ML)
- [ ] SIEM 深度对接 (Splunk HEC / Sentinel)
- [ ] SOC2 / ISO27001 审计对齐

#### 网关 (NSGW 企业级)

- [ ] Noise 数据面
- [ ] MASQUE / HTTP/3 CONNECT-UDP
- [ ] Anycast IP + BGP peering
- [ ] 跨网关热迁移 (session handoff)
- [ ] A/B 测试路由
- [ ] WAF 企业规则集 (OWASP CRS + 定制)
- [ ] Bot 管理
- [ ] 零信任策略点 (Authz Proxy)
- [ ] DDoS L3/L4 (上游对接)
- [ ] DDoS L7 (challenge)
- [ ] SO_REUSEPORT 多进程
- [ ] Gateway Mesh
- [ ] 跨区 failover
- [ ] 会话状态快照
- [ ] QoS 分类 (prod/dev/bulk)
- [ ] Linux tc / eBPF 整形
- [ ] 过载降级 (付费 tier 优先)
- [ ] 采样率控制 (telemetry)

#### 跨组件扩展

- [ ] 策略 DSL 编译产物推送 (NSD → NSN)
- [ ] 设备 Posture 上报 + 决策
- [ ] 零信任 Authz Proxy 完整链路
- [ ] 事件总线 (Kafka/NATS) + 外部 gRPC 订阅
- [ ] Kubernetes Operator (CRD + controller)
- [ ] 真正多路径 (带宽聚合)
- [ ] FEC (VoIP / 视频)
- [ ] 边缘 NSN 大规模部署 (1000+ edge 节点)
- [ ] IoT SDK (RTOS / ESP32)
- [ ] 跨云统一控制面 (AWS + GCP + Azure)
- [ ] 硬件加速 (eBPF / DPU)
- [ ] SDK Rust

### 企业级验收标准

- 10 万节点规模下 p99 注册延迟 < 1s
- 4 区跨大洲 NSGW 部署,单区失效 30 秒内完成 failover
- Anycast IP 生效,客户端无感路径切换
- 策略 DSL 可由客户 security 团队维护,编译产物推送不超过 60s
- 合规审计导出能满足 SOC2 + GDPR 要求
- air-gap 部署 license 机制跑通
- 企业客户能自行编写插件扩展 NSD 行为

### 企业级风险

| 风险 | 应对 |
|------|------|
| 多 NSD 并行的"联邦管理" UX 难设计 | 先做最小"只读视图",迭代 |
| 策略 DSL 学习曲线 | 提供 DSL → JSON 互转 + Web UI visual editor |
| Anycast 需要 AS 号 + BGP 对等 | 找 Cloudflare / AWS Global Accelerator 合作 |
| Kubernetes Operator 长期维护成本 | 社区路线 + 企业支持合同补贴 |
| 合规认证周期长 (SOC2 Type 2 需 6 个月运行记录) | Phase 2 末启动,Phase 3 末拿到 |

---

## 跨阶段里程碑

| 里程碑 | 阶段 | 验收 |
|--------|------|------|
| **M1.0 Alpha** | MVP 中期 | 3 节点 E2E 通过;Web UI 能登录 |
| **M1.1 Beta** | MVP 末 | 10 节点试点;SLA 99.5% |
| **M1.2 GA-candidate** | MVP→GA 过渡 | 100 节点压测;SLA 99.9% |
| **M2.0 GA** | GA 末 | 1000 节点;SaaS 上线;Webhook/TF/SDK 齐 |
| **M2.1 GA+Multi-region** | GA+1 Q | 3 区部署;GeoDNS 就近 |
| **M3.0 Enterprise Beta** | 企业级 中期 | 大客户试点;Anycast + 策略 DSL |
| **M3.1 Enterprise GA** | 企业级 末 | air-gap 部署;合规认证;多 NSD 并行产品化 |

---

## 研发力量估算 (相对数字,非工时)

| 能力轴 | MVP | GA | 企业级 |
|--------|-----|-----|--------|
| NSD 核心 | 3 | 4 | 6 |
| NSGW 核心 | 2 | 3 | 5 |
| 前端 Web UI | 3 | 4 | 5 |
| 后端集成 (SDK/TF/k8s/Webhook) | 1 | 3 | 4 |
| 数据面扩展 (P2P/多路径/BBR) | 0 | 1 | 3 |
| 安全 (WAF / DDoS / 合规) | 0 | 1 | 3 |
| SRE (HA / 监控 / 部署) | 1 | 2 | 3 |
| 文档 / 社区 | 1 | 2 | 2 |
| **合计 (人)** | **11** | **20** | **31** |

数字是"平均人数",不代表精确编制。

---

## 发布节奏建议

1. **MVP 小步迭代**: 每 2 周发一个 internal release
2. **GA 月度 release**: 稳定后转为月度
3. **企业版**: 季度 release,配合客户部署窗口
4. **Security patch**: 随时,独立通道

## 下一步

- 部署与运维形态 → [operational-model.md](./operational-model.md)
