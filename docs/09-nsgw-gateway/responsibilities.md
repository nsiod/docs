# NSGW 核心职责

> NSGW 只做四件事:**终结 WG**、**中继 WSS**、**反代 HTTPS**、**跟 NSD 对表**。本文把每一条的输入、输出、代码位置摊开讲清楚。

```mermaid
graph TB
    subgraph NSD["NSD 控制面"]
        SSE["SSE /api/v1/config/stream<br/>wg_config · routing_config"]
    end

    subgraph NSGW["NSGW"]
        subgraph R1["① WG endpoint · :51820/udp"]
            WG["kernel wg0<br/>peer table"]
        end

        subgraph R2["② WSS relay · :9443"]
            WSS["Bun.serve&lt;WsDataTagged&gt;<br/>/relay · /client"]
        end

        subgraph R3["③ HTTPS reverse proxy · :443"]
            TRA["traefik v3.6.13<br/>routes.yml + tls.yml"]
        end

        subgraph R4["④ Registry sync"]
            REG["subscribeToNsdSse()<br/>addPeer · handleRoutingConfig"]
        end
    end

    subgraph NSN["NSN"]
        N["gotatun WG peer<br/>(user-space)"]
    end

    SSE --> REG
    REG -->|addPeer(pubkey, allowed-ips)| WG
    REG -->|routes.yml atomic write| TRA
    TRA -->|"http://nsn_wg_ip:virtual_port"| WG
    WG ==> N
    WSS ==> N
```

## ① WireGuard UDP 端点(Mode 3: 重 NSC / NSN)

**输入**: NSC 或 NSN 通过 UDP 51820 发来 WG 握手 + 加密包。
**输出**: 解密后的 IP 包经 `wg0` 接口转发到 NSN 的虚拟 IP(由 `allowed-ips` 决定路由)。

**核心代码**:
- `tests/docker/nsgw-mock/entrypoint.sh:13-17` 在启动前用 `ip link add wg0 type wireguard` + `wg set wg0 private-key ... listen-port ...` 创建内核接口,并赋 `100.64.0.1/16`。
- `tests/docker/nsgw-mock/src/wg-setup.ts:24` 的 `addPeer()` 用 `wg set wg0 peer <pubkey> allowed-ips <cidr>` 动态增删 peer。
- `tests/docker/nsgw-mock/src/index.ts:248-278` SSE 消费 `wg_config` 事件后 diff-apply peer 集合。

**为什么用内核 WG**: NSGW 是静态常驻节点,有 root + `cap_add: NET_ADMIN`(见 [deployment.md](./deployment.md))。内核 WG 零拷贝、最低延迟,是 hub 的最佳选择。对比 NSN 选用 `gotatun` 用户态实现是为了 "无 root 也能部署"——边界见 [wg-endpoint.md](./wg-endpoint.md)。

**数据**: 参见 [../03-data-plane/tunnel-wg.md](../03-data-plane/tunnel-wg.md)。NSGW 不参与任何 WG 帧解析,内核直接投递。

## ② WSS 中继(Mode 2: 轻 NSC / NSN fallback)

**输入**: NSC 或 NSN 通过 WebSocket 建立长连接(`/client` 或 `/relay`),发来 `WsFrame` 二进制帧。
**输出**:
- NSN 侧(`/relay`)的帧转发到匹配的 NSC 客户端(`/client`)或 NSGW 直连 socket;
- NSC 侧(`/client`)的帧转发到活跃 NSN 连接器会话,或 fallback 为 NSGW 本地 TCP/UDP 直连。

**核心代码**:
- `tests/docker/nsgw-mock/src/index.ts:98-175` `Bun.serve<WsDataTagged>` 监听,用 `data.kind` 区分 `"relay"` / `"client"` 会话。
- `tests/docker/nsgw-mock/src/wss-relay.ts:281-363` `handleClientFrame()` 是"缝合点"——收到 NSC 的 `Open` 就分配 `connectorStreamId`,插入 `connectorStreamToClient` 反查表,转发给 NSN。
- `tests/docker/nsgw-mock/src/wss-relay.ts:365-421` 当无 NSN 会话可用时,`openDirectStreamForClient()` 在 NSGW 本地建立 TCP/UDP 直连——兜底路径,见 [wss-relay.md](./wss-relay.md) §fallback。

**注意: WsFrame 协议定义唯一来源**: `crates/tunnel-ws/src/lib.rs:86-94` 与 `tests/docker/nsgw-mock/src/wss-relay.ts:36-42`(两者必须字节级一致)。详细字段见 [../03-data-plane/tunnel-ws.md](../03-data-plane/tunnel-ws.md#2-wsframe-二进制协议)——本目录**引用**而不重复。

## ③ HTTPS 反向代理(Mode 1: 无 NSC 的浏览器直连)

**输入**: 外部浏览器访问 `https://app.example.com`,TCP 443 进入 traefik。
**输出**: TLS 在 traefik 终结,基于 `Host` header 选中对应 router,proxy 到 `http://<nsn_wg_ip>:<virtual_port>`——此 URL 的下一跳**经由 NSGW 的 wg0 接口**,通过 WG 隧道送达 NSN 的 ServiceRouter。

**核心代码**:
- `tests/docker/nsgw-mock/traefik.yml` 静态配置两个 entryPoint: `web:8080`(明文)/ `websecure:443`(TLS)。
- `tests/docker/nsgw-mock/entrypoint.sh:30-40` 生成 `tls.yml` 默认证书 store(mock 用自签,生产可换 Let's Encrypt)。
- `tests/docker/nsgw-mock/src/traefik-config.ts:32-68` `handleRoutingConfig()` 原子写 `/etc/traefik/dynamic/routes.yml`——每个 domain 产两个 router(HTTPS + HTTP)+ 一个 service,loadBalancer 指向 `http://${nsn_wg_ip}:${virtual_port}`。

**流量链路**:
```
Browser → :443 (traefik) → TLS 终结 → Host rule 匹配
  → http://<nsn_wg_ip>:<virtual_port>
    → 经 wg0 (kernel WG 加密)
      → NSN gotatun 解密
        → NSN ServiceRouter(ACL + 服务表查询)
          → 127.0.0.1:80 真实服务
```

这条路径上 NSGW **不懂 HTTP**——只做 TLS 终结 + Host 路由 + TCP 代理,所有应用层策略在 NSN 侧。详见 [traefik-integration.md](./traefik-integration.md)。

## ④ 与 NSD 的注册表同步

NSGW 启动时要让 NSD 知道"我是谁",并订阅 peer 变更:

**双向握手流程** (`tests/docker/nsgw-mock/src/index.ts:300-370`):

1. `POST /api/v1/machine/register` — 带上 `machine_key_pub`(hex)、`type: "gateway"`、`hostname`、`version`;最多 10 次重试,间隔 500 ms。
2. `POST /api/v1/gateway/report` — 上报 `gateway_id` + `wg_pubkey` + `wg_endpoint` + `wss_endpoint`,NSD 收到后解析 `wg_endpoint` 到 IP,广播 `wg_config` 到所有已订阅的 NSN(`tests/docker/nsd-mock/src/registry.ts:395-412`)。
3. 订阅 SSE `GET /api/v1/config/stream?machine_id=<instance>-gw` — 后续接收:
   - `wg_config` → diff-apply `wg set peer` (`nsgw-mock/src/index.ts:248-278`)
   - `routing_config` → `handleRoutingConfig()` 写 `routes.yml` (`nsgw-mock/src/index.ts:236-247`)

```mermaid
sequenceDiagram
    participant GW as NSGW
    participant ND as NSD
    participant NSN as NSN connectors

    GW->>ND: POST /api/v1/machine/register (type=gateway)
    ND-->>GW: 200 OK
    GW->>ND: POST /api/v1/gateway/report (wg_pubkey, wg_endpoint)
    ND-->>ND: gateways.set(id, { pubkey, endpoint })
    ND-->>NSN: broadcast gateway_config (all NSN/NSC)
    ND-->>NSN: broadcast wg_config (NSN with services)

    GW->>ND: GET /api/v1/config/stream?machine_id=<gw>
    ND-->>GW: immediate wg_config (NSN peer list)
    ND-->>GW: immediate routing_config (domain → nsn_wg_ip)

    loop 随 NSN 注册/注销
        ND-->>GW: wg_config event
        GW->>GW: diff → wg set wg0 peer ...
    end

    loop 随 admin 修改路由
        ND-->>GW: routing_config event
        GW->>GW: write /etc/traefik/dynamic/routes.yml
    end
```

**SSE 事件对照表**(来自 `tests/docker/nsd-mock/src/types.ts:144-153`):

| 事件 | 方向 | 载荷 | NSGW 动作 |
|------|------|------|-----------|
| `wg_config` | NSD → NSGW | `{ ip_address, listen_port, peers: [{ public_key, allowed_ips }] }` | diff + `wg set peer / wg set peer ... remove` |
| `routing_config` | NSD → NSGW | `{ routes: [{ domain, nsn_wg_ip, virtual_port }] }` | 原子写 `routes.yml`,traefik 自动 reload |
| `acl_projection` | NSD → NSGW | `{ chain_id, groups, acls }`（见 [05 · ACL · §4.6](../05-proxy-acl/acl.md#46-两级信任nsgw-预拒--nsn-终决)） | 装载到本地 `AclEngine`（projection 版），用于 /client ingress 预拒 |
| `gateway_config` | NSD → NSN/NSC(非 gateway) | `{ gateways: [...] }` | (NSGW 不消费;这是给 NSN/NSC 用的) |

## ⑤ /client ingress 的 ACL 预过滤（两级信任的前一级）

NSGW 既然在 `/client` 握手阶段已验过 NSC 的 JWT（拿到 `machine_id`），并在 `handleClientFrame()` 中已经持有 `{gateway_id=self, machine_id}`，就可以在 WsFrame `Open` 转发给 NSN **之前**先查一遍本地 ACL projection。这是 [NSN 信任 NSGW，NSGW 信任用户] 两级信任模型的"前一级"——把大部分越权访问**挡在 NSGW 的入口**，不浪费一次跨节点 RTT 把它送到 NSN 再被拒。

```mermaid
sequenceDiagram
    participant NSC
    participant NSGW
    participant NSN

    NSC->>NSGW: WSS /client + JWT
    NSGW->>NSGW: 验 JWT → machine_id
    NSC->>NSGW: WsFrame Open(target=db:5432)
    NSGW->>NSGW: subject = User{self.gw_id, machine_id}
    NSGW->>NSGW: local_acl.is_allowed(subject, target) ?
    alt projection 命中 deny
        NSGW-->>NSC: Close + reason="acl: denied by projection"
        Note over NSGW,NSN: 不打扰 NSN
    else projection allow / 未命中
        NSGW->>NSN: Open (带 TLV source identity)
        NSN->>NSN: check_target_allowed(subject, target)
        alt NSN 终决 deny
            NSN-->>NSGW: Close
            NSGW-->>NSC: Close
        else NSN allow
            NSN->>NSN: proxy → service
        end
    end
```

**职责分工**：

| 检查点 | 权威性 | 规则来源 | 失败模式 |
|--------|--------|----------|---------|
| NSGW `/client` 入口 | **非权威**，允许保守偏宽 | `acl_projection`（user/group/nsgw/* 类规则），**不含** 本地 `services.toml` floor | 早拒：~99% 越权不进入 NSN 数据面 |
| NSN `check_target_allowed` | **终决权威** | `merged_acl ∩ services.toml` | 最后一道防线；即使 NSGW 版本旧 / projection 未同步 / 被入侵, 也不会放过 |

**关键不变式**：
1. **NSGW 偏宽 + NSN 偏严 = 安全**：NSGW 可以因 projection 未同步而放过一些 NSN 会拒的；NSN 的 local floor 补齐。反过来不成立——NSGW 不能偏严，否则可能把 NSN 本来允许的也拒了。运维需确保 projection 的延迟 ≤ NSN ACL 延迟。
2. **NSGW 预拒的错误应该告知 NSC**：`Close` 帧附带结构化 reason（`CMD_CLOSE_WITH_REASON`，规划），让 NSC UI 显示"无权访问 db:5432"，而不是"连接超时"。这与 NSN 侧的"静默丢弃"策略不同——NSGW 是**已知授权的前端**，告诉 NSC 被拒不会泄露拓扑。
3. **projection SSE 断连时 fail-open**：NSGW 的本地 ACL 缺失或过期时，不阻塞流量——放行给 NSN，由 NSN 兜底。这避免了"NSGW 挂了就全站拒绝"的 DoS 放大。

详见 [05 · ACL · §4.6 两级信任：NSGW 预拒 + NSN 终决](../05-proxy-acl/acl.md#46-两级信任nsgw-预拒--nsn-终决)。

## 这些职责之间的边界

| 场景 | 责任组件 | 为什么 |
|------|---------|-------|
| 用户登录、颁发 JWT | NSD | 所有证书/token 签发都在控制面 |
| "这个 NSC 能访问 ssh:22 吗?" | **NSN 终决**；NSGW 做前置过滤 | 权威策略在 NSN（有本地 services.toml floor）；NSGW 做 defense-in-depth 的预拒 |
| 把 NSC 127.11.1.5 映射到某服务 | NSC 自身 | NSGW 不知道 VIP 的存在 |
| "北京用户应该走哪个 NSGW?" | NSN 内的 `MultiGatewayManager` | NSGW 自己不做全局选路;详 [multi-region.md](./multi-region.md) |
| TLS 终结 + Host 路由 | NSGW (traefik) | 唯一拥有公网 IP + 证书的组件 |
| TCP/UDP 字节中继 | NSGW (WSS relay or kernel WG) | 数据面桥接就是 NSGW 的核心职责 |

## 参考

- mock 实现入口: `tests/docker/nsgw-mock/src/index.ts`
- 生产参考(Go, 基于 fosrl/gerbil): `tmp/gateway/main.go` — `proxy/` 做 SNI 代理,`relay/` 做 UDP hole-punch 中继;总体设计与 NSGW mock 接近,但把 "SSE 订阅 NSD" 换成了"POST 给 `remoteConfig` URL"。差异见 [deployment.md](./deployment.md)。
