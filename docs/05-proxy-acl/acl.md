# ACL 引擎 (accept-only, default deny)

> 源码: `crates/acl/` — `lib.rs` (42), `engine.rs` (542), `matcher.rs` (289), `policy.rs` (107)

NSN 的访问控制采用 **Tailscale 风格的 accept-only 模型**: 策略里只写 `accept` 规则, 没有 `deny`; 未命中任何规则一律 **默认拒绝**。本文档描述该引擎的数据模型、匹配算法、host alias 展开、集成点与 policy test 能力。

> **重要：主体（subject）而非源 IP**。ACL 的"谁在发起访问"维度用 **主体 (`subject`)** 表达，不再是五元组里的 `src_ip`。原因：NSN 的两条入口对 `src_ip` 的语义完全不同——经 NSGW 中继的 WSS 路径上 `src_ip` 永远是 NSGW（或一个占位符），即使写了 `src: "10.0.0.0/24"` 也永远命中不了真实的 NSC。`subject` 把"用户 / 组 / 网关 / CIDR"抽象为一个**多形态标识符集合**，NSGW 在转发时由受信的 JWT 直接断言身份，NSN 接收后喂给引擎。详见 [§4 主体匹配](#4-主体匹配-subject)。

## 1. 设计总原则

| 原则 | 体现 |
|------|------|
| Accept-only | `AclAction` enum 只有 `Accept` 一个变体 (`crates/acl/src/policy.rs:41`); `"deny"` 会反序列化失败 (`crates/acl/src/policy.rs:102`) |
| Default deny | `AclEngine::is_allowed` 在规则列表耗尽后返回 `allowed=false` (`crates/acl/src/engine.rs:167`) |
| 首次命中即返回 | 规则按文件顺序编译, `for .. in compiled_rules` 发现首个匹配就 `return` (`crates/acl/src/engine.rs:142`) |
| 策略自验证 | `AclPolicy.tests` 在 `load()` 时跑一次, 失败直接 `Error::TestsFailed` 拒绝上线 (`crates/acl/src/engine.rs:118`) |
| 单入口校验 | 运行时只有 `ServiceRouter::resolve*` 三个函数会调 `AclEngine::is_allowed`, 没有数据面旁路 |

## 2. 数据模型

```rust
// crates/acl/src/policy.rs
pub struct AclPolicy {
    pub hosts: HashMap<String, String>,  // alias → CIDR 字符串
    pub acls:  Vec<AclRule>,             // 顺序敏感
    pub tests: Vec<AclTest>,             // load 时自检
}

pub struct AclRule {
    pub action:  AclAction,              // 永远是 Accept
    pub subject: Vec<String>,            // "*" | user:<id> | group:<name> | nsgw:<id> | cidr:<net> | alias
    pub dst:     Vec<String>,            // "host:ports" 形式
    pub proto:   Option<String>,         // "tcp" | "udp" | None (任意)
}

pub struct AclTest {
    pub subject: String,                 // 主体形式（与 AclRule.subject 同语法）
    pub dst:     String,                 // "ip:port"
    pub allow:   bool,                   // 期望决策
}
```

NSD 以 JSON (见 `crates/acl/src/policy.rs:75` 的 round-trip 测试) 下发该结构, `ServiceRouter::load_acl` 原子替换引擎 (`crates/nat/src/router.rs:56`)。

## 3. 匹配流程

```
AccessRequest {
    subject: Subject,   // 由调用方按路径不同填入
    dst_ip, dst_port, protocol
}
        │
        ▼
  for each CompiledRule in order:
    subject 列表里任一匹配 req.subject?  ← SubjectMatcher (见 §4)
    dst 列表里任一匹配 (dst_ip,port)?    ← DstMatcher: host ∧ port
    proto 匹配?                          ← None / Tcp / Udp
        │
        ├── 全部是: Allow, 记录 matched_rule_index
        └── 否则: 继续下一条
        │
        ▼ (规则耗尽)
  Deny, reason = "denied: no matching accept rule"
```

实现分三层 (`crates/acl/src/engine.rs:52`, `crates/acl/src/matcher.rs:17`, `:49`):

```rust
// CompiledRule.matches
if !self.subject.iter().any(|m| m.matches(&req.subject)) { return false; }
if !self.dst.iter().any(|m| m.matches(req.dst_ip, req.dst_port)) { return false; }
match self.proto {
    None => true,
    Some(Protocol::Both) => true,
    Some(proto) => proto == req.protocol,
}
```

流程图: [diagrams/acl-matcher.d2](./diagrams/acl-matcher.d2)。

## 4. 主体匹配 (`subject`)

`Subject` 是 ACL 的**身份维度**：它不假定"发起端必然在一个可识别的 IP 网段里", 而是由调用方在进入 ACL 前组装一个已知身份。两条数据通路喂给引擎的 `Subject` 完全不同：

| 调用方 | 如何获得身份 | 典型 `Subject` |
|--------|--------------|----------------|
| `tunnel-ws::check_target_allowed` (WSS 中继) | NSGW 在 WsFrame `Open` 扩展字段中携带 `{gateway_id, machine_id, user_id?}`，NSN 信任 NSGW 的 pinned 身份 | `Subject::User { gateway_id, machine_id }` |
| `ServiceRouter::resolve*` (本地服务路由 / UserSpace / TUN) | 解密后的 IP 包五元组，`src_ip` 来自真实对端 | `Subject::Cidr(src_ip)` |

这把"WSS 路径下 `src_ip` 永远是占位符"的历史缺陷（见 [10 · 批评 · SEC-013](../10-nsn-nsc-critique/security-concerns.md#sec-013)）在数据模型层就消除了——规则作者**直接按用户/组写规则**，不再依赖 NSGW 与 NSC 在同网段才能识别客户端。

### 4.1 主体形式

| 形式 | 语义 | 适用路径 |
|------|------|----------|
| `*` | 任意主体 | 全部 |
| `user:<machine_id>` | 指定 NSC/终端 (machine_id) | WSS（NSGW 断言） |
| `group:<name>` | NSD 下发的 group 成员集合（`AclConfig.groups`，见 §4.3） | WSS |
| `nsgw:<gateway_id>` | 经由此 NSGW 转发的所有流量（粗粒度） | WSS |
| `nsgw:<gateway_id>/user:<machine_id>` | 交集：必须是某用户且必须经由某 NSGW | WSS |
| `cidr:10.0.0.0/24` | IPv4/IPv6 CIDR，匹配真实 `src_ip` | 本地路径（UserSpace / TUN） |
| `alias` | host alias（仅展开为 CIDR，不展开为 user/group） | 本地路径 |

**跨路径语义**：
- `user:` / `group:` / `nsgw:` 规则**仅在 WSS 中继路径生效**；本地路径的 subject 是 `Cidr(ip)`，不会命中 user/group 规则，默认拒绝。
- `cidr:` / `alias` 规则**仅在本地路径生效**；WSS 路径的 subject 是 `User{...}`，不会命中 CIDR 规则（即便 user 的 VIP 恰好落在该 CIDR 内，引擎也不会拿 VIP 做匹配——身份来自 NSGW 断言，不来自包头 src）。
- `*` 两条路径都命中。

引擎不隐式把 `user:` 反向查到一个 IP 去和 CIDR 规则合并——这会让规则作者误以为"我在 WSS 路径写了 CIDR 也能防到 user"，实际却受制于 NSGW 填字段的完整性。保持两套维度显式分离，失败模式是"规则写错 → 默认拒绝"，不是"规则看起来生效但漏掉了某些用户"。

### 4.2 SubjectMatcher 编译结果

```rust
// crates/acl/src/matcher.rs
enum SubjectMatcher {
    Any,                                              // "*"
    User    { machine_id: String },                   // "user:<id>"
    Group   { name: String },                         // "group:<name>"
    Nsgw    { gateway_id: String },                   // "nsgw:<id>"
    NsgwUser { gateway_id: String, machine_id: String }, // "nsgw:.../user:..."
    Cidr    (IpNet),                                  // "cidr:..." 或 host alias
}

impl SubjectMatcher {
    fn matches(&self, s: &Subject) -> bool {
        match (self, s) {
            (Any, _) => true,
            (User{machine_id: m}, Subject::User{machine_id, ..}) => m == machine_id,
            (Group{name}, Subject::User{groups, ..})           => groups.contains(name),
            (Nsgw{gateway_id: g}, Subject::User{gateway_id, ..}) => g == gateway_id,
            (NsgwUser{gateway_id: g, machine_id: m},
                Subject::User{gateway_id, machine_id, ..}) => g == gateway_id && m == machine_id,
            (Cidr(net), Subject::Cidr(ip)) => net.contains(ip),
            _ => false,    // 跨维度不匹配
        }
    }
}
```

### 4.3 Group 定义

Group 由 NSD 下发, 作为 `AclConfig` 的一个顶级字段：

```rust
pub struct AclPolicy {
    pub hosts:   HashMap<String, String>,     // alias → CIDR (目的主机 / cidr 主体 复用)
    pub groups:  HashMap<String, Vec<String>>, // group_name → [machine_id, ...]
    pub acls:    Vec<AclRule>,
    pub tests:   Vec<AclTest>,
}
```

- Group 展开时机与 hosts 相同：`AclEngine::load` 里把 `group:eng` 预解析成一组 `machine_id` 集合, 匹配时 O(1) 查表。
- Group 不级联：group 的值必须是 machine_id 列表, 不能嵌套另一个 group。
- NSD 侧 group 成员来自 RBAC 用户表 / 角色表（生产实现 `tmp/control/server/db/pg/schema/schema.ts:376` 的 `roles`）。mock 目前不实现 groups, 规则只能用显式 `user:<id>`。

### 4.4 `Subject::User` 的两种身份来源

`Subject::User { gateway_id, machine_id }` 是同一个数据结构, 但 NSN 可以通过**两条独立路径**组装出来, **可信度不同**：

| 路径 | 身份来源 | 信任根 | 失效/滥用模式 |
|------|----------|--------|---------------|
| **WSS 中继**（NSC → NSGW → NSN） | NSGW 在 [Open TLV](../03-data-plane/tunnel-ws.md#24-open-帧的-source-identity-扩展) 中断言 `{gateway_id, machine_id}` | NSN 信 NSGW（NSGW↔NSN 的 wss 连接 pin 到 `gateway_config.wss_endpoint` + TLS/Noise） | 恶意 / 被入侵的 NSGW 可**冒名**任意 `machine_id`；防线是 NSGW 本身的密钥安全和 NSD 在 `gateway_config` 里的 endpoint pin |
| **直连 WG**（NSC → NSN，planned，见 [01 · ecosystem §直连路径](../01-overview/ecosystem.md)） | NSN 从 `wg_config.peers[].allowed_ips` → `machine_id` 反查（见 §4.5） | WG 协议的公钥 pinning（NSC 的 `peer_key_pub` 由 NSD 下发给 NSN） | 冒名需要拿到 NSC 的 WG 私钥——**crypto-grounded**；NSGW 不在信任路径上 |

**零信任 NSGW 场景**：部署方可以禁用 WSS relay 路径（`disable_wss_relay = true`，规划中），只允许直连 WG。这种情况下 `Subject::User` 的来源全部走 §4.5 的反查，不再有 "相信 NSGW 断言" 的语义。

### 4.5 直连 WG 路径：从 `allowed_ips` 反查 `machine_id`

NSD 下发给 NSN 的 `wg_config` 在原有 `{public_key, endpoint, allowed_ips}` 之外, 为每个 peer 追加 **`machine_id: Option<String>`**（规划字段；见 [02 · control-plane 设计 §4.2](../02-control-plane/design.md#42-合并规则)）。NSN 主进程在装配 AppState 时维护一份 `Arc<ArcSwap<PeerIdentityMap>>`：

```rust
struct PeerIdentityMap {
    // /32 或 /128 → machine_id
    // 来源：wg_config.peers 展开 allowed_ips
    by_ip: BTreeMap<IpAddr, String>,
}

impl PeerIdentityMap {
    fn lookup(&self, src_ip: IpAddr) -> Option<&str> {
        // 精确匹配 /32 或 /128；不做 longest-prefix，避免"多用户共享一段"
        self.by_ip.get(&src_ip).map(String::as_str)
    }
}
```

`ServiceRouter::resolve*` 构造 `Subject` 时的完整规则：

```rust
let subject = match peer_map.lookup(src_ip) {
    Some(machine_id) => Subject::User {
        gateway_id: "direct".into(),       // 占位；规则里写 nsgw:direct 才能匹配
        machine_id: machine_id.into(),
    },
    None => Subject::Cidr(src_ip),         // 非 WG peer（如站点内本地服务）
};
```

**含义**：
- WG peer 发来的流量会**自动升级**为 `Subject::User`, 于是 NSD 下发的 `user:` / `group:` 规则直接生效, 不依赖 NSGW 填 TLV。
- 如果某 `/32` 出现在多个 peer 的 `allowed_ips` 里（配置错误），NSD 合并层必须在下发前拒绝；NSN 侧假设 1:1 映射。
- `nsgw:direct` 是约定保留字，用于规则作者区分"只对直连路径生效的策略"（例如：`subject: ["nsgw:direct/user:ab3xk9mnpq"]` 只接受该用户的直连流量，任何经 NSGW 的同 machine_id 断言都不会命中）。

### 4.6 两级信任：NSGW 预拒 + NSN 终决

即便 NSN 已经持有完整的 ACL, 让每个 Open 都"打到 NSN 才被拒"仍浪费资源（一次 TLS 建链 + 一次 wss 帧 + 一次 ACL 查询 + 一次 Close 回帧）。NSGW 既然知道 `{gateway_id, machine_id}`（它必须知道, 才能填 TLV）, 就可以**在 /client ingress 先自己查一遍**。

[NSGW 预拒 + NSN 终决两级信任](./diagrams/nsgw-nsn-two-stage.d2)

**职责分工**：

| 层 | 输入 | 规则来源 | 权威性 | 失败模式 |
|----|------|----------|--------|---------|
| **NSGW 预拒** | JWT 解出的 machine_id + Open.target | NSD 推送的 `acl_config`（**投影版**：只含 acls / groups，不含 `hosts` 或 tests 以外的站点私有元数据） | 可能偏**宽松**——没有 services.toml 本地 floor, 可能放过 NSN 最终会拒的包 | 早拒（99% 的越权请求在此被截住, 不进入 NSN 数据面） |
| **NSN 终决** | Open TLV 的 Subject + merged ACL + 本地 services.toml | 与今天 [§6 ServiceRouter 集成](#6-servicerouter-集成) 一致 | **权威** | 最后一道防线；即使 NSGW 没更新规则 / 被入侵篡改 projection, NSN 依然独立判决 |

**关键不变式**：
1. **两层都 deny → deny**，两层都 allow → allow，**冲突时以 NSN 为准**（NSN 更严格就以 NSN 为准，NSN 更宽松也不"回填"给 NSGW——NSGW 的 projection 可以比真 ACL 保守）。
2. NSGW 的 projection **不替代** NSN 的 ACL——两边独立加载；若 NSGW 的 SSE 断连, 降级为"全部放行 + 让 NSN 兜底"而不是"全部拒绝"（见 [SEC-001](../10-nsn-nsc-critique/security-concerns.md#sec-001) 的 fail-open/closed 权衡）。
3. NSGW 预拒的结构化错误**立即**通过 `Close` 帧的 payload 告知 NSC（新增 `CMD_CLOSE_WITH_REASON`, 规划中）, 让 NSC UI 显示 "无权访问目标 X"，而不是"连接超时"——今天的静默丢弃（见 [§6 几个重要事实](#6-servicerouter-集成)）在 NSGW 侧改为**显式拒绝**，在 NSN 侧仍保持静默（不泄露拓扑）。

**NSGW 订阅的 ACL projection**（新增 SSE 事件 `acl_projection`）：

```jsonc
{
  "event": "acl_projection",
  "chain_id": "acl-2026-04-17-001",
  "gateway_id": "nsgw-primary",
  "payload": {
    "groups": { "eng": ["ab3xk9mnpq", "cd4yl0nrqs"] },
    "acls":   [ /* 仅含 subject 维度能被 NSGW 判定的规则 —— user:/group:/nsgw: */ ]
  },
  "sig": { /* 与其他 SSE 事件同样的 Ed25519 签名，见 02 · design · §7.2 */ }
}
```

NSD 在生成 projection 时做一次预过滤：
- `subject` 含 `cidr:` / alias 的规则**不下发给 NSGW**（NSGW 看不到五元组 src_ip，下发了也没用）；
- `subject` 为 `user:` / `group:` / `nsgw:` / `*` 的规则按常规下发；
- `dst` 里 host alias 展开为 CIDR（NSGW 不持有 `hosts` 表）。

### 4.7 Destination (`dst`)

格式固定为 `host:ports`, `rfind(':')` 拆分 (`crates/acl/src/matcher.rs:98`)。

| 形式 | 语义 |
|------|------|
| `*:*` | 任意主机 + 任意端口 |
| `192.168.0.0/24:80` | CIDR + 单端口 |
| `alias:5432` | alias + 单端口 |
| `alias:80,443` | alias + 端口列表 (`PortMatcher::List`, `matcher.rs:133`) |
| `alias:8000-8999` | alias + 端口范围 (`PortMatcher::Range`, `matcher.rs:145`; 反序范围会报错 `matcher.rs:152`) |
| `alias:*` | alias + 任意端口 |

### 4.8 Protocol

- 省略 `proto` (JSON 里不写字段) → 匹配 TCP 和 UDP;
- `"tcp"` / `"udp"` → 精确匹配 (`crates/acl/src/matcher.rs:165`)。
- `common::Protocol::Both` (来自 `ServicesConfig`) 也会被视为"任意匹配" (`crates/acl/src/engine.rs:62`), 用于 `services.toml` 里同时暴露 TCP+UDP 的服务。

## 5. Host alias 展开

`AclEngine::load` 里 `resolve_hosts` 把 alias→CIDR 字符串全部预解析成 `IpNet`, 失败报 `Error::InvalidCidr` (`crates/acl/src/engine.rs:229`)。alias 展开的关键性质:

| 性质 | 说明 |
|------|------|
| 展开时机 | 在 `load()` 阶段一次性完成, 后续 `is_allowed` 零字符串操作 |
| 作用域 | `dst.host` 以及 `subject` 的 `cidr:` 形式可以引用 alias；不展开为 user/group |
| 不级联 | alias 的值必须是 CIDR 字符串, 不能是另一个 alias |
| 精确到段 | alias 可以表示 `/32` 单机, 也可以表示一个子网 `/24` |
| 更新即全替 | NSD 下发新的 `AclPolicy` 时, `AclEngine::load` 重编译, 整个引擎 `RwLock::write` 替换 (`crates/nat/src/router.rs:58`) |

决策表 (accept-only + default deny):

| 规则匹配情况 | 决策 | 备注 |
|--------------|------|------|
| 策略为空 (`acls = []`) | **Deny** | `crates/acl/src/engine.rs` test `empty_policy_denies_everything` (`:293`) |
| 任意一条 `accept` 规则匹配 | **Allow**, `matched_rule_index = i` | `:142` |
| 全部规则都不匹配 | **Deny**, `matched_rule_index = None` | `:167` |
| 规则 proto=tcp, 请求是 udp | 当前规则跳过, 继续找下一条 | `:60` |
| subject alias / group / user 引用未定义 (加载期) | `AclEngine::load` 返回 `Error::InvalidPolicy("rule N subject: ...")` | `:93` |
| 内建测试不通过 | `Error::TestsFailed { count }` | `:129` |
| WSS 路径规则写了 `cidr:` / 本地路径规则写了 `user:` | 不跨维度匹配 → 当前规则跳过 | 见 [§4 跨路径语义](#4-主体匹配-subject) |

## 6. ServiceRouter 集成

[ServiceRouter 集成时序](./diagrams/service-router-sequence.d2)

三个 resolve 函数都走同一个模式 (`crates/nat/src/router.rs:71`, `:117`, `:162`):

```rust
// 1. 服务查找
let (name, svc) = services.find_named_by_*()?;

// 2. ACL 校验 (accept-only / default deny)
let acl_guard = self.acl_engine.read().await;
if let Some(acl) = acl_guard.as_ref() {
    let req = acl::AccessRequest {
        subject: Subject::Cidr(src_ip),   // 本地路径：用真实五元组 src
        dst_ip,
        dst_port: <port>,                 // resolve: dst_port; resolve_by_host: 80; resolve_by_sni: 443
        protocol: <proto>,                // resolve: proto;    resolve_by_host: Tcp; resolve_by_sni: Tcp
    };
    if !acl.is_allowed(&req).allowed {
        tracing::debug!(...);
        return None;                      // 直接丢弃连接, 不回错给客户端
    }
}

// 3. DNS 解析 backend 地址
let target = resolve_host(&svc.host, svc.port).await?;
```

WSS 中继路径的调用点 (`crates/tunnel-ws/src/lib.rs` `check_target_allowed`) 则从 `Open` 帧的扩展字段组装 `Subject::User`:

```rust
// tunnel-ws, WsFrame Open 扩展见 03 · data-plane · tunnel-ws.md §2.4
let subject = Subject::User {
    gateway_id: open.source.gateway_id.clone(),
    machine_id: open.source.machine_id.clone(),
    groups: /* 由 AclEngine 在 match 时从 AclPolicy.groups 反查 */,
};
let req = acl::AccessRequest { subject, dst_ip, dst_port, protocol };
```

几个重要事实:

- **`acl_engine` 是 `Option`**: 未下发策略时 `acl_engine = None`, resolve 不做 ACL 检查 (**只**发生在启动早期, NSD SSE 尚未推送)。生产部署应确保至少有一条初始策略随 `services_ack` 一起到达, 否则早期连接相当于放行。
- **ACL 决策不依赖域名 / SNI**: 对 L7 路由, ACL 用的是虚拟端口 80/443, 和 [http-host-routing.md §5](./http-host-routing.md#5-acl-在-http-路由中的语义) 一致。
- **拒绝静默丢弃**: 拒绝后不回 TCP RST / ICMP, 客户端看到的是"连接挂起直到超时", 这是"不泄露网络拓扑"的刻意设计。
- **多 NSD 合并 + 本地保底**: 多个 NSD 推送的策略在 `control` 层取**并集**并标注来源 NSD;**运行时放行由本地 `services.toml` ACL 作为最终保底**——即使某个 NSD 下发 `allow all`,本地未列出的 FQID/端口也不会放行。详见 [multi-realm.md §4.5](../08-nsd-control/multi-realm.md#45-本地-acl-作为保底)。合并后的单一 `AclPolicy` 才送到 `AclEngine::load`。

## 7. Policy test — 不跑流量就验证策略

`AclPolicy.tests` 让策略作者在下发前就断言"哪些流应该通/阻", 避免部署后才发现规则漏洞。

```rust
// crates/acl/src/policy.rs:48
pub struct AclTest {
    pub subject: String,    // "user:ab3xk9mnpq" | "cidr:10.0.0.2" | "group:eng" | ...
    pub dst:     String,    // "192.168.1.5:80"
    pub allow:   bool,      // 期望结果
}
```

执行路径 (`crates/acl/src/engine.rs:175`):

1. 对每个 `AclTest` 解析 `subject` 字符串为 `Subject` (语法同 [§4.1](#41-主体形式)), 拆 `dst` 为 `(IpAddr, u16)` (`crates/acl/src/engine.rs:242`);
2. 构造 `AccessRequest { protocol: Protocol::Tcp, .. }` (测试默认走 TCP, proto 为空的规则会 match TCP 也 match UDP);
3. 调 `self.is_allowed(&req)`;
4. 若 `decision.allowed != test.allow` 追加一条 `AclTestFailure`, 附详细 reason (`crates/acl/src/engine.rs:211`);
5. `AclEngine::load` 在发现任何失败时直接返回 `Error::TestsFailed`, 引擎不会被装载。

工作流示例（WSS 中继路径，按用户授权）:

```yaml
# 在 NSD 侧编写
groups:
  eng: ["ab3xk9mnpq", "cd4yl0nrqs"]
hosts:
  db: 192.168.1.10/32
acls:
  - action: accept
    subject: ["group:eng"]
    dst:     ["db:5432"]
    proto:   tcp
tests:
  - { subject: "user:ab3xk9mnpq",  dst: "192.168.1.10:5432", allow: true  }  # eng 组成员
  - { subject: "user:ab3xk9mnpq",  dst: "192.168.1.10:6379", allow: false } # 端口外应拒
  - { subject: "user:xz9pq0rstu",  dst: "192.168.1.10:5432", allow: false } # 非 eng 组应拒
  - { subject: "cidr:10.0.0.2",    dst: "192.168.1.10:5432", allow: false } # 本地路径不命中 user/group 规则
```

NSD 把策略推给 NSN 时, NSN 的 `ServiceRouter::load_acl` 会触发 `AclEngine::load`, 若任一 test 失败:

- 日志输出 `"ACL policy test failed"` (`crates/acl/src/engine.rs:121`), 带 `subject=/dst=/expected=/reason=` 四个字段;
- `load_acl` 返回 `Err(AclError)`, ServiceRouter 保留**旧**策略继续工作 (原子替换的正确性保证);
- 运维可以在 `/api/acl` 端点看到 "pending" 状态。

> 这是一个非常弱的 "canary": 它只能证伪显式写出的断言, 不能证明策略全局正确。真实防线还是需要通过测试环境回放真实流量, 配合 `/api/connections` 观察 ACL 拒绝率。

## 8. 运行时观测

- 日志: accept 走 `debug` (`crates/acl/src/engine.rs:144`), deny 走 `warn` (`crates/acl/src/engine.rs:160`, `"ACL deny: no matching rule"`), 可以用 `RUST_LOG=acl=warn` 把日志压缩成"只显示拒绝";
- 审计字段: deny 日志带 `subject=<user:... | cidr:... | ...>` / `dst=<ip:port>` / `proto=`，WSS 路径额外带 `gateway_id=<...>`; 这使"是哪个用户经过哪个 NSGW 被拒"在审计流里可以直接回溯（老版本永远显示 `src_ip=0.0.0.0` 的盲点已不存在）；
- Monitor API: NSN 通过 `/api/acl` 暴露当前策略快照与最近若干拒绝事件 (详见 [07 · NSN 节点](../07-nsn-node/index.md));
- 端到端事实: `/api/connections` 记录每条连接的 ACL 决策和匹配规则下标, 便于审计回放。

## 9. 错误表

`crates/acl/src/lib.rs:27`:

| Error | 触发场景 |
|-------|----------|
| `InvalidCidr { addr, reason }` | `hosts.*` 或 `subject`/`dst` 中的 CIDR 语法非法 |
| `InvalidSubject { value, reason }` | `subject` 前缀不是 `*` / `user:` / `group:` / `nsgw:` / `nsgw:.../user:...` / `cidr:` / alias 之一 |
| `InvalidDst { dst, reason }` | `dst` 缺 `:`、端口非数字、范围反转等 |
| `UnknownAlias(name)` | `subject`/`dst` 引用了未在 `hosts` 中定义的 alias |
| `UnknownGroup(name)` | `subject` 引用了未在 `groups` 中定义的组名 |
| `TestsFailed { count }` | 内建 `tests` 至少一条未通过 |
| `InvalidPolicy(msg)` | 其他编译期错误 (规则字段组合非法等) |

所有错误都在 `load()` 阶段抛出, 运行时 `is_allowed` 是零失败接口。

## 10. 测试矩阵

`crates/acl/src/engine.rs:260` 的单元测试覆盖:

- 默认拒绝 (`empty_policy_denies_everything`)
- 通配 `*:*` 允许任意 (`wildcard_rule_allows_any_connection`)
- `cidr:` 在内/外区分 (`cidr_rule_allows_in_range_denies_outside`)
- `user:` 精确匹配 (`user_subject_matches_by_machine_id`)
- `group:` 反查成员 (`group_subject_resolves_members`)
- `nsgw:` 粗粒度匹配 + `nsgw:/user:` 复合 (`nsgw_subject_filters_by_gateway`, `nsgw_user_subject_requires_both`)
- 跨维度不匹配：WSS 规则对本地请求 deny, 本地规则对 WSS 请求 deny (`cross_path_subject_rejects`)
- host alias 解析 (`host_alias_resolves_correctly`)
- TCP/UDP 过滤 (`proto_tcp_rule_rejects_udp`, `no_proto_rule_matches_tcp_and_udp`)
- 端口 range / list (`port_range_rule`, `port_list_rule`)
- 优先级按规则顺序 (`first_matching_rule_wins`)
- 内建 tests 的正反路径 (`builtin_tests_pass_on_valid_policy`, `builtin_tests_fail_returns_error`)
- 错误路径 (`invalid_host_alias_in_rule_returns_error`, `invalid_cidr_in_hosts_returns_error`, `unknown_group_returns_error`)

`crates/acl/src/matcher.rs:176` 补充细粒度的 `parse_subject` / `parse_dst` / `parse_protocol` 语法测试。

## 11. 延伸阅读

- [proxy.md](./proxy.md) — `handle_tcp_connection` / `handle_udp` 底层原语
- [http-host-routing.md](./http-host-routing.md) — :80 路由在 ACL 侧为何用固定端口
- [sni-routing.md](./sni-routing.md) — :443 路由同理
- [02 · 控制面](../02-control-plane/index.md) — NSD 如何下发 `AclConfig` 与多源合并策略
