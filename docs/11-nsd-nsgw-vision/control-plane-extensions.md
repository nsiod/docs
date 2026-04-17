# 控制面扩展能力

> **读者**: 架构师 / 平台负责人 / SDK 开发者。
>
> **目标**: 聚焦那些**跨越单个组件**的控制面能力 —— 不是 NSD 内部某个模块,也不是 NSGW 某个功能,而是**让 NSD / NSGW / NSN / NSC 协同工作的控制面契约**。这些契约是 NSIO 生产化的核心。

## 什么是"控制面扩展"

控制面的本意是"谁、在哪、能访问什么"的权威来源。一旦 NSD 不再是"mock + 内存 registry",控制面需要新增一批能力,这些能力**单靠 NSD 自己做不出来**,必须数据面组件配合。典型的跨组件控制面能力:

- 策略 DSL:NSD 编译 DSL 到内部表示,NSN/NSGW 消费内部表示
- 策略仿真:NSD 用历史流量重放,数据来源是 NSGW/NSN 上报的连接日志
- 设备 Posture:NSN/NSC 上报设备状态,NSD 把状态用到策略决策
- 零信任 Authz:NSGW 在路由前查询 NSD,NSD 综合身份 + 策略返回 allow/deny
- 计费:NSGW 上报 bytes,NSD 聚合 + 出账

本章列这些"跨组件"的能力,补充单组件 vision 没有覆盖的契约设计。

## 控制面契约(当前 vs 未来)

当前控制面契约见 `tests/docker/nsd-mock/src/index.ts:8-18`:

```
Inbound:
  POST /api/v1/machine/register   — 注册
  POST /api/v1/machine/auth       — 签名认证
  POST /api/v1/device/code        — device flow
  POST /api/v1/device/token       — device flow poll
  POST /api/v1/services/report    — NSN 上报 services
  POST /api/v1/gateway/report     — NSGW 上报 endpoint

Outbound (SSE):
  GET  /api/v1/config/stream      — wg_config / proxy_config / acl_config / routing_config / dns_config / gateway_config
```

未来生产 NSD 需要补的契约:

| 新契约 | 方向 | 用途 | 支撑能力 |
|--------|------|------|----------|
| `POST /api/v1/machine/posture` | NSN/NSC → NSD | 上报设备状态 (OS / 磁盘加密 / 2FA) | F2.9 条件策略 |
| `POST /api/v1/authz` | NSGW → NSD | 查询"这个用户对这个 resource 能做什么" | G3.7 零信任策略点 |
| `POST /api/v1/billing/ingest` | NSGW → NSD | 上报 bytes / duration / connection | F5.13 计费 |
| `POST /api/v1/gateway/topology` | NSGW → NSD | 上报活跃 peer 与 session 状态 | F4.2 连接拓扑图 |
| `POST /api/v1/events` | Any → NSD | 通用事件上报 | F5.10 事件总线 |
| SSE `ca_bundle_update` | NSD → NSGW | 证书包更新 | F1.1 Machine PKI |
| SSE `quota_update` | NSD → NSGW | 每 org 配额更新 | G6.2 配额 |
| SSE `policy_version` | NSD → NSN/NSGW | 策略版本号 | F2.2 ACL 版本号 |
| SSE `gateway_drain` | NSD → NSN | 通知 NSN "网关 X 即将下线" | G4.2/G4.3 热升级 |
| `GET /api/v1/policy/simulate` | CLI / SDK → NSD | 策略仿真查询 | F2.5 策略仿真 |
| Webhook POST (客户 URL) | NSD → 客户 | 事件外发 | F5.9 Webhook |

### 契约扩展的兼容性原则

1. **向后兼容**: 新增事件类型,不删旧类型;新增字段必须 optional
2. **版本协商**: register 时协商控制面协议版本 (`protocol_version: "2.0"`)
3. **可插拔传输**: 新契约要同时工作在 SSE / Noise / QUIC 三种传输上

---

## 能力 C1: 策略 DSL

### 今天怎么表达策略

今天 ACL 以 JSON 事件形式下发。假设 mock 现在推一条允许规则,JSON 大致长这样 (从 `crates/acl/` 的 ACL 结构推断):

```json
{ "type": "acl_config", "rules": [
  { "src_user": "*", "dst_cidr": "10.0.0.0/24", "dst_port": 22, "action": "allow" }
]}
```

### DSL 形态(预测)

```rego
package nsio.acl

default allow = false

allow {
    input.user.groups[_] == "devs"
    input.target.site == "prod-ssh"
    time.within_business_hours(input.time)
    input.device.posture.encrypted_disk == true
}
```

或者类 ZeroTier 的简洁 flow rules:

```
accept ipprotocol tcp dport 22 tag department=engineering;
drop;
```

### DSL 在组件间的流动

[策略 DSL 组件间流动时序](./diagrams/policy-dsl-flow.d2)

**关键点**: NSN 永远只看到编译后的内部表示,不看 DSL。NSD 保留 DSL 源码做版本管理和仿真。

### 落地路径

- MVP: JSON 硬编码,不做 DSL
- GA: 简化版 DSL (类 flow rules)
- 企业级: 完整 Rego / CEL + 仿真

---

## 能力 C2: 设备 Posture

### 契约设计

```
POST /api/v1/machine/posture
{
  "machine_id": "nsc-alice-laptop",
  "reported_at": "2026-04-16T10:00:00Z",
  "posture": {
    "os": "macOS 14.4",
    "disk_encryption": true,
    "firewall_enabled": true,
    "av_running": "defender:online",
    "screen_lock_seconds": 300,
    "mdm_enrolled": true,
    "fingerprint": "<signed attestation blob>"
  }
}
```

### 跨组件协作

- **NSC 采集**: 定期(30s)扫描本地状态,`POST /posture`
- **NSD 决策**: 收到后更新 machine state,触发 policy re-evaluation
- **SSE 回推**: `acl_config` 带新规则下发给相关 NSN/NSGW

### 技术挑战

- **防篡改**: posture 由客户端自证,需要 attestation (macOS: system integrity;Windows: TPM;Linux: 较难)
- **频率**: 30s 扫描是合理上限,太频繁 battery / CPU 开销大
- **隐私**: posture 泄露过多设备信息给 NSD,需要字段最小化

### 落地级别

- MVP: 无
- GA: 基础 posture (OS version + disk encryption)
- 企业级: 完整 posture + attestation

---

## 能力 C3: 零信任 Authz Proxy

### 契约设计

```
POST /api/v1/authz
{
  "principal": { "user_id": "alice", "groups": ["devs"] },
  "resource": { "id": "res_xyz", "kind": "http", "path": "/admin" },
  "request": { "method": "GET", "ip": "1.2.3.4" }
}

Response:
{
  "decision": "allow" | "deny" | "challenge",
  "reason": "matched rule r_42",
  "ttl": 300,
  "challenge": { "kind": "2fa" }  // 当 decision=challenge
}
```

### 调用方

- NSGW 在 TLS 终结后、路由前调用
- 可缓存 `ttl` 秒内的决策(相同 principal + resource)

### 对 NSIO 独立主张的影响

目前 NSIO 的 ACL 执行在 NSN (`crates/acl/`),**NSN 才是真正的 policy enforcement point**。加入 Authz Proxy 会让 NSGW 也成为 PEP,这是**可选的附加**,不替代 NSN 的 ACL。

好处: 拒绝请求更早发生,不消耗 NSN 资源;BAD request 不用穿越隧道。

---

## 能力 C4: CLI & SDK

### CLI 定位

`nsdctl` 是**和 kubectl 一样重要**的产品表面。参考现有 Pangolin admin CLI (`tmp/control/cli/commands/`):

```
tmp/control/cli/commands/
├── clearExitNodes.ts
├── clearLicenseKeys.ts
├── deleteClient.ts
├── generateOrgCaKeys.ts
├── resetUserSecurityKeys.ts
├── rotateServerSecret.ts
└── setAdminCredentials.ts
```

只有 7 条,**都是破坏性 admin 操作**。真正的日常 CLI 需要覆盖所有资源:

```
nsdctl site list
nsdctl site create --name my-site --region us-east
nsdctl user add alice --email a@x.com --role admin
nsdctl policy apply -f policy.rego
nsdctl policy simulate --user alice --target ssh.site.n.ns
nsdctl gateway list
nsdctl log tail --org my-org --since 1h
nsdctl token create --name ci-bot --scope site:read
nsdctl backup export --output /tmp/backup.tar.gz
```

### SDK 设计原则

1. **同构 API**: 四种语言 SDK (TS / Python / Go / Rust) 提供**相同方法签名**,参数名一致
2. **自动生成**: 从 OpenAPI spec 生成,减少漂移
3. **强类型**: TS/Rust 泛型 + Python pydantic + Go struct tags

### SDK 示例 (TS)

```ts
import { NsdClient } from "@nsio/sdk";

const nsd = new NsdClient({ apiKey: process.env.NSD_API_KEY! });

// 创建站点
const site = await nsd.sites.create({
  name: "branch-office-tokyo",
  region: "ap-northeast-1",
});

// 订阅事件
nsd.events.on("gateway.down", (evt) => {
  console.log(`Gateway ${evt.gatewayId} went offline`);
});
```

### 落地级别

- MVP: TS SDK
- GA: TS + Python + Go
- 企业级: +Rust + Kubernetes Operator

---

## 能力 C5: Terraform Provider

### 资源类型

```hcl
resource "nsio_site" "prod_web" {
  name   = "prod-web"
  region = "us-east"
}

resource "nsio_user" "alice" {
  email = "alice@company.com"
  role  = "admin"
}

resource "nsio_policy" "devs_to_prod_ssh" {
  source      = file("${path.module}/policies/devs.rego")
  enforcement = "enforce"
}

resource "nsio_gateway" "tokyo" {
  region    = "ap-northeast-1"
  protocols = ["wg", "wss", "quic"]
}

data "nsio_org" "this" {
  slug = "my-company"
}
```

### 状态同步

Terraform state 与 NSD 真实状态可能漂移 (有人在 Web UI 改了),provider 要有 `nsio_*` 数据源做"读取真实状态"。

### 落地级别

- GA。

---

## 能力 C6: Webhook

### 事件格式

```json
{
  "id": "evt_01HKXN...",
  "type": "site.joined",
  "created_at": "2026-04-16T10:00:00Z",
  "org_id": "org_abc",
  "payload": { "site_id": "site_xyz", "machine_id": "nsn-1", "hostname": "web-1" }
}
```

### 传输

- POST 到客户 URL
- HMAC-SHA256 签名 (`X-NSD-Signature: sha256=<hex>`)
- 重试 5 次,指数退避 (1s, 2s, 4s, 8s, 16s)
- 幂等: event `id` 全局唯一,客户端去重

### 事件类型(建议初版)

- `machine.registered` / `machine.revoked`
- `site.joined` / `site.left`
- `gateway.up` / `gateway.down`
- `user.created` / `user.deleted`
- `policy.applied` / `policy.rolled_back`
- `acl.denied` (可选: 默认关,避免 spam)
- `billing.threshold_exceeded`

---

## 能力 C7: 事件总线 (内外统一)

### 架构

[事件总线架构](./diagrams/event-bus-architecture.d2)

### 关键决策

- **Kafka 还是 NATS**: Kafka 成熟但重,NATS JetStream 轻量。(建议: 本地部署 NATS, SaaS 用 Kafka)
- **Schema 管理**: 全部事件用 CloudEvents v1.0 规范,Schema Registry 管理版本

### 落地级别

- GA (内部 only)
- 企业级 (外部可订阅 via gRPC stream)

---

## 能力 C8: 多 NSD 并行 (差异化主张)

### 今天 NSN 侧已有

- `crates/control/src/multi.rs` (`MultiControlPlane`) 聚合多个 NSD 的 SSE
- `crates/control/src/merge.rs:56` (`merge_proxy_configs` 入口,去重在第 63 行) 按 `resource_id` 合并去重

### NSD 侧需要的配合

目前 NSD 互不感知 —— NSN 自己决定连哪几个。这是**优点**(无共享状态),但也有限制:

1. **跨 NSD 策略冲突**: 甲 NSD 允许 "alice → site_x",乙 NSD 拒绝;按"仅允许"模型,甲允许就行,但需要有机制让运营者看到**这种冲突**
2. **跨 NSD 计费**: 一个 NSN 流量同时属于两个 NSD 吗?本轴需要定义
3. **跨 NSD 审计日志**: 管理员需要一个**联邦视图**看全

### 落地级别

- MVP / GA 不强制多 NSD 并行
- 企业级作为差异化能力 + 附加"联邦审计" (可选)

详细路径见 [roadmap.md](./roadmap.md) 和 [feature-matrix.md](./feature-matrix.md)。

---

## 能力 C9: Kubernetes Operator

### CRD

```yaml
apiVersion: nsio.io/v1alpha1
kind: NsSite
metadata:
  name: prod-web
  namespace: default
spec:
  name: prod-web
  region: us-east
  resources:
    - kind: http
      domain: app.example.com
      target: http://nginx:8080
---
apiVersion: nsio.io/v1alpha1
kind: NsPolicy
metadata:
  name: devs-to-prod-ssh
spec:
  source: |
    allow {
      input.user.groups[_] == "devs"
      input.target.site == "prod-ssh"
    }
```

### 价值

- k8s 原生管理; GitOps 流程天然适配
- 多 cluster 场景下每 cluster 部署 operator,独立同步

### 落地级别

- 企业级。

---

## 跨组件能力总览

[跨组件能力总览](./diagrams/cross-component-capabilities.d2)

---

## 下一步

- 数据面的跨组件能力 → [data-plane-extensions.md](./data-plane-extensions.md)
- 横向功能矩阵 → [feature-matrix.md](./feature-matrix.md)
