# 功能矩阵 (Feature Matrix)

> **读者**: 产品 / 销售 / PM。
>
> **目标**: 用一张大表横向对比 NSIO 当前 vs MVP vs GA vs 企业级 vs 竞品 (tailscale / headscale),快速看清楚**我们现在在哪里、要去哪里、别人已经到哪了**。

## 列说明

| 列 | 含义 |
|----|------|
| **当前 (mock/ref)** | 今天 NSIO 的状态 —— mock 里有 / 参考 tmp/ 里有 / 主工程有 / 无 |
| **Sub-8/9 规划** | docs/08 和 docs/09 在描述当前时提到的"应该做"但未实现项 |
| **本愿景 MVP** | [roadmap.md](./roadmap.md) MVP 阶段交付 |
| **本愿景 GA** | GA 阶段交付 |
| **本愿景 企业级** | 企业级阶段交付 |
| **tailscale** | tailscale 有 (✅) / 待调研 (?) / 无 (❌) —— 基于公开文档 |
| **headscale** | headscale (开源 tailscale 控制面) 有 (✅) / 待调研 (?) / 无 (❌) —— 基于 github.com/juanfont/headscale |

## 状态符号

- ✅ 有
- 🟡 部分有 / 雏形 / 简化实现
- ❌ 没有
- ? 待调研(公开资料不确定)
- — 不适用

## 覆盖度总览

[功能能力覆盖度四象限](./diagrams/feature-coverage-quadrant.d2)

---

## 身份与组织 (NSD F1.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| 机器身份 (Ed25519) | ✅ mock `tests/docker/nsd-mock/src/auth.ts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Machine PKI 根 (X.509) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| 本地用户账号 | 🟡 参考 `tmp/control/src/app/auth/login/` | 🟡 | ✅ | ✅ | ✅ | ? | ✅ |
| OIDC SSO | 🟡 参考 `tmp/control/src/lib/idp/oidcIdpProviderDefaults.ts` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SAML 2.0 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| SCIM 用户同步 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 多租户 Org | 🟡 参考 `tmp/control/src/app/[orgId]/` | 🟡 | ✅ | ✅ | ✅ | ✅ (tailnet) | ❌ (单实例) |
| Realm (shared/self-hosted) | ✅ mock types.ts | ✅ | ✅ | ✅ | ✅ | — | — |
| User API Key | 🟡 参考 `tmp/control/src/components/ApiKeysTable.tsx` | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| Org API Key | 🟡 参考 `tmp/control/src/components/OrgApiKeysTable.tsx` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Admin API Key | 🟡 参考 `tmp/control/src/app/admin/api-keys/` | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| Service Account | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 2FA (TOTP) | 🟡 参考 `tmp/control/src/app/auth/2fa/` | ❌ | 🟡 | ✅ | ✅ | ? | ❌ |
| FIDO2 / WebAuthn | 🟡 参考 `tmp/control/src/components/SecurityKeyForm.tsx` | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| Device Flow (RFC 8628) | ✅ mock `auth.ts` POST `/api/v1/device/code` | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| 邀请机制 | 🟡 参考 `tmp/control/src/components/InvitationsTable.tsx` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 审批工作流 | 🟡 参考 `tmp/control/src/components/ApprovalFeed.tsx` | ❌ | ❌ | ✅ | ✅ | ? | ❌ |

**小计**: 17 项,当前 NSIO 完成 1 项 ✅ + 8 项 🟡。

---

## 策略与编排 (NSD F2.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| ACL 下发 (SSE) | ✅ `crates/control/src/sse.rs` + mock `registry.ts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ACL 合并 (resource_id) | ✅ `crates/control/src/merge.rs:56` | ✅ | ✅ | ✅ | ✅ | ❌ (单源) | ❌ (单源) |
| ACL 版本号 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ? |
| 策略 DSL | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (HuJSON) | ✅ (HuJSON) |
| 策略测试工具 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ (`tailscale debug`) | ? |
| 策略仿真 (historical) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ? |
| 策略版本化 + 回滚 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ? |
| 策略灰度发布 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ? |
| 定时策略 (time-window) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ? |
| 条件策略 (device posture) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 策略审批 (2-person) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| 路由下发 | ✅ `routing_config` 事件 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 路由优先级 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ? |
| 服务发现 | ✅ `proxy_config` + `services.toml` | ✅ | ✅ | ✅ | ✅ | ✅ (MagicDNS) | ✅ |
| 条件 DNS | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| Ingress 策略 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Egress 策略 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

**小计**: 17 项。

---

## 网络编排 (NSD F3.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| Gateway 注册 | ✅ `POST /api/v1/gateway/report` mock | ✅ | ✅ | ✅ | ✅ | ✅ (DERP) | ✅ (DERP) |
| Gateway 区域标签 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ? |
| NSN 多网关选路 | ✅ `crates/connector/src/multi_gateway_manager.rs` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 站点分组 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ? |
| 用户分组 | ❌ | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| 跨站点直连 (via NSGW) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 跨站点 P2P | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (direct) | ? |
| Exit Node | 🟡 参考 `tmp/control/src/components/ExitNodesTable.tsx` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Subnet Router | 🟡 参考雏形 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 拓扑编辑器 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 流量工程 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| Provisioning Key | 🟡 参考 `tmp/control/src/app/[orgId]/settings/provisioning/keys/` | ❌ | ✅ | ✅ | ✅ | ✅ (auth keys) | ✅ (pre-auth) |
| Blueprint 模板 | 🟡 参考 `tmp/control/src/app/[orgId]/settings/blueprints/` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| 域名管理 + ACME | 🟡 参考 `tmp/control/src/app/[orgId]/settings/domains/` | ❌ | 🟡 | ✅ | ✅ | ✅ (`*.ts.net`) | 🟡 |
| Resource 管理 | 🟡 参考 `tmp/control/src/app/[orgId]/settings/resources/` | ❌ | 🟡 | ✅ | ✅ | ✅ (resource) | ✅ |
| Share Link | 🟡 参考 `tmp/control/src/app/[orgId]/settings/share-links/` | ❌ | ❌ | ✅ | ✅ | ✅ (Funnel) | ❌ |

**小计**: 16 项。

---

## 可观测与审计 (NSD F4.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| 实时设备列表 (UI) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 连接拓扑图 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 流量分析看板 | 🟡 参考 `tmp/control/src/app/[orgId]/settings/logs/analytics/` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 连接日志 (4 层) | 🟡 参考 logs/connection | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 请求日志 (7 层) | 🟡 参考 logs/request | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 访问日志 (ACL) | 🟡 参考 logs/access | ❌ | 🟡 | ✅ | ✅ | ✅ | ❌ |
| 审计日志 (Action) | 🟡 参考 logs/action | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| 流式日志 (Live tail) | 🟡 参考 logs/streaming | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 告警引擎 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| SLA 月报 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| OpenTelemetry 统一 | 🟡 NSN 侧 `crates/telemetry/` | ❌ | 🟡 | ✅ | ✅ | ? | ❌ |
| SIEM 导出 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 异常检测 (ML) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |

**小计**: 13 项。

---

## 运营与生态 (NSD F5.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| Web UI | 🟡 参考 `tmp/control/src/components/Layout.tsx` | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ (社区有 headscale-ui) |
| i18n | 🟡 参考 `tmp/control/messages/` 16 种 | ❌ | 🟡 (en+zh) | ✅ | ✅ | ? | ❌ |
| 深色模式 | 🟡 参考 `tmp/control/src/components/ThemeSwitcher.tsx` | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| CLI (nsdctl) | 🟡 参考 7 条 admin `tmp/control/cli/commands/` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenAPI spec | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| SDK TypeScript | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ (社区) | ? |
| SDK Python | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ (社区) | ? |
| SDK Go | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| SDK Rust | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Webhook | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ? |
| 事件总线 (内部) | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 事件总线 (外部订阅) | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| Terraform Provider | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Kubernetes Operator | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (K8s Operator) | ❌ |
| Billing / Stripe | 🟡 参考 billing 页 | ❌ | ❌ | ✅ | ✅ | ✅ | — |
| License (离线) | 🟡 参考 license 页 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 插件系统 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 初始设置向导 | 🟡 参考 `tmp/control/src/app/setup/` | ❌ | ✅ | ✅ | ✅ | — (SaaS) | ✅ |
| 邮件通知 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| 组织仪表盘 | 🟡 参考 OrgInfoCard | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |

**小计**: 20 项。

---

## 高可用与扩展 (NSD F6.x)

| 功能 | 当前 | Sub-8 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| 持久化 (SQLite) | ❌ (mock 内存) | ❌ | ✅ | ✅ | ✅ | ✅ (coordination) | ✅ |
| 持久化 (Postgres) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| NSD 多实例 (active-active) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 跨区 NSD | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **多 NSD 并行** (差异化) | ✅ `crates/control/src/multi.rs` (`MultiControlPlane`) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 读写分离 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| Redis 缓存 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| NSD 热升级 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 备份 + PITR | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 (手工) |
| SSE 快照 CDN 化 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| API 限流 | ❌ | ❌ | 🟡 | ✅ | ✅ | ✅ | ? |
| IP 黑白名单 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| Maintenance Mode | 🟡 参考 `tmp/control/src/app/maintenance-screen/` | ❌ | ✅ | ✅ | ✅ | ? | ❌ |

**小计**: 13 项。

---

## NSGW 连接 (G1.x)

| 功能 | 当前 | Sub-9 | MVP | GA | 企业 | tailscale (DERP) | headscale (DERP) |
|------|------|-------|-----|-----|-------|-----------|-----------|
| WireGuard UDP 终结 | ✅ mock + `tmp/gateway/main.go` | ✅ | ✅ | ✅ | ✅ | — (DERP 是 WS) | — |
| WSS relay | ✅ mock `wss-relay.ts` | ✅ | ✅ | ✅ | ✅ | ✅ (DERP 是 WS) | ✅ |
| QUIC 数据面 | ❌ (控制面有) | ❌ | ❌ | ✅ | ✅ | ? | ? |
| Noise 数据面 | ❌ (控制面有) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| MASQUE / HTTP/3 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| UDP Hole Punch (NSGW-coordinated) | 🟡 参考 `tmp/gateway/relay/relay.go:21-33` | ❌ | ❌ | ✅ | ✅ | ✅ (`tailscale netcheck`) | ✅ |
| 内置 STUN | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 内置 TURN | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (DERP) | ✅ |
| PROXY Protocol v1 | ✅ `tmp/gateway/main.go:134-223` | ✅ | ✅ | ✅ | ✅ | ? | ❌ |
| PROXY Protocol v2 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| mTLS 终结 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| SO_REUSEPORT 多进程 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ? |
| Gateway Mesh (G2G) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

**小计**: 13 项。

---

## NSGW 路由 (G2.x)

| 功能 | 当前 | Sub-9 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| WG peer 动态同步 | ✅ mock `subscribeToNsdSse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| traefik 动态路由 | ✅ mock `handleRoutingConfig` | ✅ | ✅ | ✅ | ✅ | ❌ (不用 traefik) | ❌ |
| SNI 代理 | ✅ `tmp/gateway/proxy/proxy.go` | 🟡 | ✅ | ✅ | ✅ | ✅ (Funnel) | ❌ |
| Anycast IP | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| GeoDNS | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| 跨网关热迁移 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| 路由优先级 + 回落 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| Path-based routing | 🟡 参考 Pangolin | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Header-based routing | 🟡 参考 Pangolin | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| A/B 测试路由 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Virtual Port 路由 | ✅ mock | ✅ | ✅ | ✅ | ✅ | — | — |

**小计**: 11 项。

---

## NSGW 安全 (G3.x)

| 功能 | 当前 | Sub-9 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| 基础限速 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| UDP flood 防御 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| IP 信誉 / CrowdSec | 🟡 参考 `tmp/control/install/crowdsec.go` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| WAF (基础) | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| WAF (企业) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Bot 管理 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 零信任策略点 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Resource 级认证 | 🟡 参考 Pangolin | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| DDoS L3/L4 | ❌ | ❌ | ❌ | ❌ | ✅ (依赖上游) | ? | ❌ |
| DDoS L7 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Trusted Upstream | ✅ `tmp/gateway/main.go:216` | ❌ | ✅ | ✅ | ✅ | ? | ❌ |
| Slow loris 防护 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |

**小计**: 12 项。

---

## NSGW 容灾 / 观测 / 资源 (G4/G5/G6)

| 功能 | 当前 | Sub-9 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-------|-----|-----|-------|-----------|-----------|
| Health check `/healthz` | ✅ mock + gerbil | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Graceful shutdown | ✅ gerbil `main.go:404-424` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 热升级 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 蓝绿 / 金丝雀 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 跨区 failover | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 会话状态快照 | ❌ | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| Prometheus metrics | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pprof | ✅ gerbil 默认 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenTelemetry traces | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 结构化访问日志 | 🟡 traefik 默认 | ❌ | ✅ | ✅ | ✅ | ? | ❌ |
| 连接级日志 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 带宽上报 | ✅ gerbil `periodicBandwidthCheck` | ✅ | ✅ | ✅ | ✅ | ? | ❌ |
| 实时拓扑上报 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 内存 watchdog | ✅ gerbil `monitorMemory` | ✅ | ✅ | ✅ | ✅ | ? | ❌ |
| 每 peer 带宽计量 | 🟡 gerbil 雏形 | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 每 org 配额 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| QoS 分类 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Linux tc 整形 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 计费埋点 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| WSS 背压 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| 连接数上限 | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |

**小计**: 21 项。

---

## 跨组件 (控制面 + 数据面扩展)

| 功能 | 当前 | MVP | GA | 企业 | tailscale | headscale |
|------|------|-----|-----|-------|-----------|-----------|
| 多 NSD 并行 | ✅ `MultiControlPlane` + merge.rs:56 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 策略 DSL (Rego/CEL) | ❌ | ❌ | ❌ | ✅ | ✅ (HuJSON) | ✅ (HuJSON) |
| 设备 Posture | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Authz Proxy (零信任) | ❌ | ❌ | ❌ | ✅ | ✅ (Access) | ❌ |
| CLI 全覆盖 | 🟡 7 条 admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK (4 语言) | ❌ | ❌ | ✅ (TS/Py/Go) | ✅ (+Rust) | 🟡 (Go only) | 🟡 |
| Terraform Provider | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Kubernetes Operator | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Webhook + 签名 | ❌ | ❌ | ✅ | ✅ | ✅ | ? |
| 事件总线 | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| P2P 直连 | ❌ | ❌ | 🟡 | ✅ | ✅ | ✅ |
| 多路径 (WG+WSS) | 🟡 (failover only) | 🟡 | ✅ | ✅ | ❌ | ❌ |
| BBR/CC 可选 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| FEC | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 边缘 NSN | 🟡 设计上支持 | 🟡 | ✅ | ✅ | ? | ? |
| IoT / 移动端 SDK | ❌ | ❌ | ✅ | ✅ | ✅ (iOS/Android) | ❌ |
| 跨云统一 | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 私有 DNS | 🟡 .ns 体系 | ✅ | ✅ | ✅ | ✅ (MagicDNS) | 🟡 |
| BYO-CA | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| 硬件加速 (eBPF/DPU) | ❌ | ❌ | ❌ | ✅ | ? | ❌ |

**小计**: 20 项。

---

## 总表汇总

| 维度 | 功能总数 | 当前 ✅ | 当前 🟡 | 当前 ❌ | MVP 新增 | GA 新增 | 企业新增 |
|------|---------|---------|---------|---------|---------|---------|---------|
| 身份与组织 | 17 | 2 | 8 | 7 | +5 | +6 | +4 |
| 策略与编排 | 17 | 4 | 0 | 13 | +2 | +8 | +5 |
| 网络编排 | 16 | 2 | 8 | 6 | +3 | +8 | +3 |
| 可观测与审计 | 13 | 0 | 9 | 4 | +2 | +9 | +2 |
| 运营与生态 | 20 | 0 | 13 | 7 | +7 | +8 | +5 |
| NSD 高可用 | 13 | 1 | 2 | 10 | +3 | +6 | +4 |
| NSGW 连接 | 13 | 3 | 1 | 9 | +2 | +4 | +5 |
| NSGW 路由 | 11 | 4 | 2 | 5 | +3 | +5 | +3 |
| NSGW 安全 | 12 | 1 | 2 | 9 | +2 | +6 | +4 |
| NSGW 容灾/观测/资源 | 21 | 5 | 2 | 14 | +5 | +10 | +6 |
| 跨组件 | 20 | 1 | 4 | 15 | +2 | +7 | +11 |
| **总计** | **173** | **23** | **51** | **99** | **+36** | **+77** | **+52** |

**关键观察**:

- **当前已完全落地 23 项**,集中在数据面基础契约 (SSE/REST/WG/WSS) 和**差异化能力 "多 NSD 并行"**
- **雏形/参考实现 51 项**,主要来自 `tmp/control/` (Pangolin fork) —— 这是 NSIO 可以**继承的免费午餐**
- **完全缺失 99 项**,企业级功能占绝大多数 (52 项企业级)
- **MVP 需要交付 36 项新功能** —— 体量适合 2 个季度
- **GA 需要再交付 77 项** —— 体量适合 4 个季度
- **企业级额外 52 项** —— 体量适合 8 季度

---

## 对标结论: NSIO vs tailscale vs headscale

### NSIO 领先

| 领先项 | 原因 |
|--------|------|
| **多 NSD 并行** | NSN 侧 `MultiControlPlane` 已有,别家都是单源 |
| **协议可插拔控制面** | SSE / Noise / QUIC 三套传输共用解析器,别家一般只有一种 |
| **.ns 命名 + 127.11.x.x VIP** | 不需要 TUN 权限,企业笔记本/CI runner 直接跑 |
| **ACL 仅允许模型** | 更简单的合规语义 |
| **Blueprint 模板** | 参考 Pangolin 有,tailscale/headscale 没有 |

### NSIO 落后(当前)

| 落后项 | 追齐的预期阶段 |
|--------|--------------|
| Web UI | MVP |
| 本地用户 + OIDC | MVP |
| 持久化 DB | MVP |
| P2P 直连 | GA |
| Exit Node / Subnet Router | GA |
| Terraform Provider | GA |
| Anycast IP | 企业级 |
| WAF / 零信任策略点 | 企业级 |

### 对 SAM 的启示

**NSIO 如果要和 tailscale 直接竞争 SaaS 生意**: 至少要到 GA 才有可能,因为 tailscale 最强项是"SaaS + 多语言 SDK + k8s 集成"。

**NSIO 如果要和 headscale 竞争 self-hosted 生意**: MVP 阶段就可以直接 PK —— headscale 没有 Web UI,NSIO 有;headscale 没有多租户,NSIO 有 (继承自 Pangolin);headscale 没有细粒度审计日志,NSIO 有。

**NSIO 如果要做企业专用(air-gap + 合规)**: 要直接跳到企业级的**多 NSD 并行 + BYO-CA + 离线 license + 合规导出**,别家没有这个组合。

下一章 → [roadmap.md](./roadmap.md)
