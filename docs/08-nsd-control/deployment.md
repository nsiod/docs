# NSD 部署形态

> NSD 有两种完全不同形态的实现：**mock**（`tests/docker/nsd-mock/`，Bun/TS，用于 E2E 测试）和**生产**（`tmp/control/`，Next.js + drizzle ORM + PostgreSQL/SQLite，为真实运维设计）。本章对比两者、列出依赖与扩展路径，并给出多 NSD 并发部署的实操要点。

## 1. 两种形态对比

| 维度 | mock (`tests/docker/nsd-mock/`) | 生产 (`tmp/control/`) |
|------|--------------------------------|----------------------|
| 运行时 | Bun | Node.js + Next.js 15 |
| 主体语言 | TypeScript | TypeScript |
| 持久化 | 进程内 `Map` | PostgreSQL / SQLite via drizzle ORM |
| Web UI | 无（只有 `/api/v1/services` 快照） | Next.js App Router + shadcn/ui |
| 身份提供者 | 无（只有 authkey / device_flow） | OIDC（IdP 表） + 本地账号 + 2FA + WebAuthn |
| SSE 订阅表 | 进程内 Map | 通常配合 Redis pub/sub（生产扩展） |
| Noise IK 握手 | 进程内实现（`noise-listener.ts`） | 独立 proxy 二进制 |
| QUIC 握手 | spawn Rust 子进程 `/app/nsd-quic-proxy` | 同上，或 envoy/nginx-quic |
| ACL 下发 | **未实现**（mock 不 push `acl_config`） | 由 roles/userResources 合成 |
| 证书管理 | 无 | traefik + Let's Encrypt |
| 审计日志 | 仅 `console.log` | `requestAuditLog` 表 + 结构化 logger |
| 资源开销 | ~40 MB RSS、单进程 | 多进程（Next worker 池） + DB |

## 2. mock 的启动细节

`tests/docker/nsd-mock/src/index.ts` 启动三个监听器：

[mock NSD 三个监听器拓扑](./diagrams/deployment-mock-listeners.d2)

关键环境变量（`tests/docker/nsd-mock/src/config.ts:26`）：

| 变量 | 默认 | 作用 |
|------|-----|-----|
| `CONTROL_PORT` | `3000` | HTTP/SSE 监听端口 |
| `NOISE_PORT` | `4001` | Noise IK TCP 监听 |
| `QUIC_PORT` | `4002` | QUIC UDP 监听 |
| `NSD_TYPE` | `selfhosted` | `GET /api/v1/info` 返回的 `type` |
| `NSD_REALM` | `default` | 返回的 `realm` |
| `PING_INTERVAL_MS` | `30000` | 心跳间隔（mock 未实际发出） |
| `TOKEN_REFRESH_MS` | `300000` | token 续签间隔（mock 未实际发出） |

**关键行为**：
- `idleTimeout: 0`（`index.ts:67`）——SSE 连接不得被 Bun idle 超时杀掉。
- Noise 握手成功后建立透明代理：`NSN → Noise → 解密 → HTTP → localhost:CONTROL_PORT`（`noise-listener.ts:295`）。
- QUIC 通过独立 Rust 子进程 `/app/nsd-quic-proxy` 处理，mock 只负责启动与读取证书指纹（`quic-listener.ts:29`）。

## 3. 生产 NSD 的依赖

### 3.1 运行时依赖

`tmp/control/package.json` / `Dockerfile` 揭示：

- **Node.js 20+ / Next.js 15** 服务端运行时。
- **drizzle-kit** 做 schema migration，既支持 PostgreSQL（`docker-compose.pgr.yml`）又支持 SQLite（`docker-compose.drizzle.yml` 中的 libSQL）。
- **lucia / better-auth-style session** + custom 2FA / WebAuthn。
- **traefik v3.x** 消费 `/api/v1/traefik` 路由输出（`server/routers/traefik/`）。
- **email / SMTP** 用于邮箱验证与密码重置（`server/emails/`）。
- **i18n** 中英双语（`src/i18n/`）。

### 3.2 部署拓扑

[生产 NSD 的 HA 部署拓扑](./diagrams/deployment-ha-topology.d2)

### 3.3 多 NSD 实例的挑战

mock 把所有状态放进程内，天然不可横向扩展。生产 NSD 横向扩展需要解决的问题：

1. **machines / services / gateways 表**：共享数据库即可。
2. **subscribers Map**：每个 NSD 进程只知道自己的订阅者；某 NSN 的 `services_report` 到了 NSD-1，NSD-2 上连着的订阅者收不到事件。解决方案：Redis pub/sub 广播事件、粘性会话（同一 machine_id 永远路由到同一实例）、或让所有实例都轮询 DB 变更日志。
3. **session 一致性**：用户浏览器 session 在所有 NSD 实例可见（共享 DB session 表）。
4. **SSE 心跳与 sticky routing**：traefik 层配置 sticky session，否则客户端重连时 `machine/auth` 可能落到不同实例。

## 4. 与其他组件的网络拓扑

[NSD 与其他组件的网络拓扑](./diagrams/deployment-network-topology.d2)

- **traefik** 同时扮演 NSD 的前置反代 + NSGW 的动态反代。两种角色共用同一个 traefik 二进制。
- NSGW 自身也是 NSD 的客户端（`POST /api/v1/gateway/report` + SSE 订阅），没有特殊路径。

## 5. 可观测性

### 5.1 mock

只有 `console.log`。每条重要事件（注册、订阅、推送）都有结构化前缀：

```
[register] machine_id=ab3xk9mnpq machine_key_pub=0001020304050607...
[sse] subscriber sub-2 connected (machineId=ab3xk9mnpq)
[sse → NSN] pushed wg_config + proxy_config to ab3xk9mnpq (web.ab3xk9mnpq.n.ns)
[gateway_report] registered nsgw-1 wg_endpoint=172.18.0.5:51820 (total gateways: 1)
```

适合 E2E 测试抓取但不适合生产（无等级、无 trace、无 metrics）。

### 5.2 生产应具备

| 能力 | 建议实现 |
|------|---------|
| 结构化日志 | pino / winston + JSON 输出 |
| 请求 trace | OpenTelemetry exporter |
| Metrics | Prometheus exporter（订阅者数 / register QPS / SSE 下发速率 / JWT 签发数） |
| 审计 | `requestAuditLog` 表（`schema.ts:983`）记录所有 admin 操作 |
| 告警 | 订阅者数急降、register 错误率飙升、数据库复制延迟 |

## 6. 本地开发套件

仓库根目录 `docker-compose.test.yml` 定义了 mock NSD + NSN + NSGW + NSC 的完整 E2E 拓扑；mock 的 Dockerfile 在 `tests/docker/nsd-mock/Dockerfile`。

```bash
# 启动完整测试拓扑
cd /app/ai/nsio
docker compose -f docker-compose.test.yml up -d

# 验证 mock 就绪
curl http://localhost:3000/ready              # "ok"
curl http://localhost:3000/api/v1/info | jq   # NsdInfoResponse
curl http://localhost:3000/api/v1/machines    # 已注册机器列表
```

mock 的 CONNECTOR_VIRTUAL_IP / SERVER_VIRTUAL_IP 等旧字段（`config.ts:10-13`）保留但未在当前路由中使用——它们是遗留配置，不影响行为。

## 7. 升级路径：从 mock 迁到生产 NSD

自研 / 接入生产 NSD 时的最小 checklist：

- [ ] 所有 HTTP 端点走 TLS（NSD 前置 traefik 或 ingress）。
- [ ] 启用真实的 JWT 签名（RS256 / ES256），暴露 `/.well-known/jwks.json`。
- [ ] authkey 表实现一次性 / 限用次数 / 过期 / 可撤销。
- [ ] device_flow 的 `/device` 页面实现真实用户批准 UI。
- [ ] heartbeat 路由要求 JWT 且 `sub == body.machine_id`。
- [ ] gateway/report 路由要求 JWT（gateway 的 JWT）。
- [ ] 实现 `acl_config` 事件的下发（mock 没做）。
- [ ] SSE 订阅多实例广播（Redis / NATS）。
- [ ] 数据库迁移脚本（drizzle migration）。
- [ ] Prometheus 指标 + OpenTelemetry trace。
- [ ] 审计日志 + 敏感操作告警。
- [ ] 证书自动化（Let's Encrypt 或企业 CA）。

一旦这 12 项完成，生产 NSD 可以替换 mock 进入真实运行环境——数据面侧（NSN / NSGW / NSC）完全无需改代码，因为它们只依赖本章与 [api-contract.md](./api-contract.md)、[sse-events.md](./sse-events.md) 描述的线上契约。
