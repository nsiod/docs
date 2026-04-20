# NSGW · 功能全景

> 本页是 NSGW **当前实现**的精简索引。详细描述请到 [`docs/09-nsgw-gateway/`](../09-nsgw-gateway/index.md) 7 篇原文档。
>
> 数据基于 HEAD 2026-04-20;NSGW 本身**不在本仓库的 Rust 代码内**——当前有两套参考实现:
>
> - **mock**: `tests/docker/nsgw-mock/` (Bun + TypeScript,用于 E2E 测试)
> - **生产参考**: `tmp/gateway/` (Go,fosrl/gerbil fork,**未对接 NSIO SSE**)
>
> 两者遵循同一套外部协议契约:WG UDP + HTTPS + WSS + 与 NSD 的注册 / 订阅。差异见 [§1 部署形态](#1-部署形态) 末表。

## 1. 部署形态

| 实现 | 路径 | 语言 | 用途 | 代码规模 |
| ---- | ---- | ---- | ---- | -------- |
| mock | `tests/docker/nsgw-mock/` | Bun + TS | Docker E2E 测试 | 5 TS 文件 ~ 1200 行 |
| 生产参考 | `tmp/gateway/` (gerbil fork) | Go 1.23 | Pangolin 系统数据面 | `main.go` 1317 行 + relay/proxy |

**mock 与 gerbil 的关键差异**(详见 [09 · deployment.md §生产参考的显著差异](../09-nsgw-gateway/deployment.md#生产参考gerbil的显著差异)):

| 维度 | mock | gerbil |
| ---- | ---- | ------ |
| WG 管理 | `wg` CLI(shell out) | `wgctrl` Go 库(netlink) |
| HTTPS 反代 | traefik v3.6.13 | 自研 SNI proxy + PROXY v1 |
| 配置同步 | **SSE 订阅 NSD** | HTTP POST/GET(pull) |
| peer 变更 | SSE → diff apply | HTTP endpoint `/peer` |
| 带宽上报 | 无 | 10s 周期 `POST /receive-bandwidth` |
| UDP hole-punch | 无 | `relay/relay.go` 支持 |
| MTU/MSS | 未显式处理 | `ensureMSSClamping()` iptables mangle |

## 2. 四条核心职责

NSGW 职责清单(参见 [09 · responsibilities.md](../09-nsgw-gateway/responsibilities.md)):

### ① WireGuard UDP 终结

- **输入**: NSC / NSN 通过 `51820/udp` 发来 WG 握手 + 加密包
- **输出**: 解密的 IP 包经 `wg0` kernel 接口转发到 NSN 虚拟 IP(由 `allowed-ips` 路由)
- **代码**:
  - entrypoint 创建接口: `tests/docker/nsgw-mock/entrypoint.sh:13-17`
  - 动态 peer: `tests/docker/nsgw-mock/src/wg-setup.ts:24` `addPeer()`
  - SSE → peer diff: `tests/docker/nsgw-mock/src/index.ts:248-278`
- **原文**: [09 · responsibilities §①](../09-nsgw-gateway/responsibilities.md#-wireguard-udp-端点mode-3-重-nsc--nsn)

### ② WSS 中继(WsFrame)

- **输入**: NSC 或 NSN 通过 WebSocket 建立长连接(`/client` 或 `/relay`),发 `WsFrame` 二进制帧
- **输出**:
  - NSN 侧(`/relay`)帧转发到匹配的 NSC 客户端会话或 NSGW 直连 socket
  - NSC 侧(`/client`)帧转发到活跃 NSN 连接器会话,或 fallback 为 NSGW 本地 TCP/UDP 直连
- **缝合逻辑**: `tests/docker/nsgw-mock/src/wss-relay.ts:281-363` `handleClientFrame()` 收到 NSC 的 `Open` → 分配 `connectorStreamId` → 插入 `connectorStreamToClient` 反查表
- **Fallback**: 无 NSN 会话时 `openDirectStreamForClient()` 在 NSGW 本地建 TCP/UDP 直连(`wss-relay.ts:365-421`)
- **WsFrame 协议**: 定义权威于 `crates/tunnel-ws/src/lib.rs:86-94`;mock 与生产必须字节级一致
- **原文**: [09 · responsibilities §②](../09-nsgw-gateway/responsibilities.md#-wss-中继mode-2-轻-nsc--nsn-fallback) · 协议见 [03 · tunnel-ws](../03-data-plane/tunnel-ws.md#2-wsframe-二进制协议)

### ③ HTTPS 反向代理(traefik)

- **输入**: 外部浏览器 `https://app.example.com` → TCP 443 → traefik
- **输出**: TLS 终结 → 基于 Host 选 router → proxy 到 `http://<nsn_wg_ip>:<virtual_port>`,下一跳经 `wg0` 进 WG 隧道送达 NSN
- **代码**:
  - 静态 entryPoints: `tests/docker/nsgw-mock/traefik.yml`(web:8080 / websecure:443)
  - 证书 store: `tests/docker/nsgw-mock/entrypoint.sh:30-40`(mock 自签;生产用 Let's Encrypt)
  - 动态路由生成: `tests/docker/nsgw-mock/src/traefik-config.ts:32-68` `handleRoutingConfig()` 原子写 `/etc/traefik/dynamic/routes.yml`
- **流量链路**:
  ```
  Browser → :443 (traefik) → TLS 终结 → Host 匹配
    → http://<nsn_wg_ip>:<virtual_port>
      → 经 wg0 (kernel WG)
        → NSN gotatun 解密
          → NSN ServiceRouter(ACL + 服务表)
            → 127.0.0.1:80 真实服务
  ```
- **关键**: NSGW **不懂 HTTP** —— 只做 TLS 终结 + Host 路由 + TCP 代理。应用层策略全在 NSN。
- **原文**: [09 · responsibilities §③](../09-nsgw-gateway/responsibilities.md#-https-反向代理mode-1-无-nsc-的浏览器直连) · 细节见 [09 · traefik-integration](../09-nsgw-gateway/traefik-integration.md)

### ④ 与 NSD 的注册表同步

NSGW 启动时双向握手,并订阅 SSE:

1. `POST /api/v1/machine/register` — 带 `machine_key_pub`(hex)、`type: "gateway"`、`hostname`、`version`;**最多 10 次重试**,间隔 500 ms
2. `POST /api/v1/gateway/report` — 上报 `gateway_id` + `wg_pubkey` + `wg_endpoint` + `wss_endpoint`(**5 次重试**);NSD 解析 `wg_endpoint` 到 IP,广播 `wg_config` 到所有已订阅的 NSN
3. 订阅 SSE `GET /api/v1/config/stream?machine_id=<instance>-gw` —
   - `wg_config` → diff-apply `wg set peer`
   - `routing_config` → `handleRoutingConfig()` 原子写 `routes.yml`,traefik 自动 reload
   - `acl_projection` → 装载本地 ACL(projection 版)用于 `/client` ingress 预拒

**SSE 事件对照表**(来自 [`tests/docker/nsd-mock/src/types.ts:144-153`](../09-nsgw-gateway/responsibilities.md#-与-nsd-的注册表同步)):

| 事件 | 方向 | NSGW 动作 |
| ---- | ---- | --------- |
| `wg_config` | NSD → NSGW | diff + `wg set peer / remove` |
| `routing_config` | NSD → NSGW | 原子写 `routes.yml`,traefik auto-reload |
| `acl_projection` | NSD → NSGW | 装载本地 `AclEngine`(projection),用于 `/client` ingress 预拒 |
| `gateway_config` | NSD → NSN/NSC(非 gateway) | NSGW **不消费** |

- **代码**: `tests/docker/nsgw-mock/src/index.ts:300-370`
- **原文**: [09 · responsibilities §④](../09-nsgw-gateway/responsibilities.md#-与-nsd-的注册表同步)

### ⑤ `/client` ingress 的 ACL 预过滤(两级信任前一级)

NSGW 在 `/client` 握手阶段已验过 NSC 的 JWT(拿到 `machine_id`),`handleClientFrame()` 持有 `{gateway_id=self, machine_id}` → WsFrame `Open` 转发给 NSN **之前**先查本地 ACL projection。

**两级信任职责分工**:

| 检查点 | 权威性 | 规则来源 | 失败模式 |
| ------ | ------ | -------- | -------- |
| NSGW `/client` 入口 | **非权威**,允许保守偏宽 | `acl_projection`(user/group/nsgw/* 类规则),**不含** services.toml floor | 早拒 ~99% 越权 |
| NSN `check_target_allowed` | **终决权威** | `merged_acl ∩ services.toml` | 最后一道防线 |

**关键不变式**:
1. NSGW 偏宽 + NSN 偏严 = 安全:NSGW projection 延迟可接受;反过来不成立
2. NSGW 预拒的错误应告知 NSC:`Close` 帧附带结构化 reason(`CMD_CLOSE_WITH_REASON`,规划)
3. projection SSE 断连时 **fail-open**:避免"NSGW 挂 → 全站拒"

- **原文**: [09 · responsibilities §⑤](../09-nsgw-gateway/responsibilities.md#-client-ingress-的-acl-预过滤两级信任的前一级) · 总论 [05 · ACL §4.6](../05-proxy-acl/acl.md#46-两级信任nsgw-预拒--nsn-终决)

## 3. 三端口入站矩阵

| 端口 | 协议 | 进入方 | 用途 | 实现 |
| ---- | ---- | ------ | ---- | ---- |
| `51820/udp` | WireGuard | NSC / NSN | L3 全隧道,最低延迟 | kernel WG + `wg` CLI (mock) / `wgctrl` (gerbil) |
| `443/tcp` | HTTPS (traefik) | Browser / NSC / 外部 | 基于 Host 头的 HTTPS 反代 | traefik v3.6.13 (mock) / 自研 SNI proxy (gerbil) |
| `9443/tcp` (mock) / `443/wss` (prod) | WSS (WsFrame) | NSN / NSC | TCP/UDP 多路复用中继,UDP 被阻断时 fallback | `Bun.serve<WsDataTagged>` (mock) |

## 4. 启动顺序(mock `entrypoint.sh`)

```
① wg genkey                           # 每启动生成新密钥
② wg pubkey < priv > pub
③ ip link add wg0 type wireguard      # 需要 NET_ADMIN
④ wg set wg0 private-key ... listen-port $WG_PORT
⑤ ip addr add 100.64.0.1/16 dev wg0
⑥ ip link set wg0 up
⑦ echo 1 > /proc/sys/net/ipv4/ip_forward
⑧ openssl req -x509 → 自签证书
⑨ cat > /etc/traefik/dynamic/tls.yml
⑩ traefik --configFile=... &          # 后台
⑪ exec bun run src/index.ts           # 前台 PID 1
```

**已知小缺陷**:`traefik` 后台启动,不接 SIGTERM;生产建议用 `supervisord` / `s6`。

Bun 进程后续:加载配置 → 读公钥 → 可选预挂 connector peer → 启动健康 API → 启动 WSS relay(若 `ENABLE_WSS_RELAY=true`)→ 对每个 `controlCenter` 注册 + 订阅 SSE。

详见 [09 · deployment.md §启动顺序](../09-nsgw-gateway/deployment.md#启动顺序entrypoint-视角)。

## 5. 与 NSD 的注册表同步

**双向握手时序**(见 [09 · responsibilities §④](../09-nsgw-gateway/responsibilities.md#-与-nsd-的注册表同步)):

```
NSGW启动 → POST /machine/register(10 次重试)
        → POST /gateway/report(5 次重试,带 wg_pubkey + wg_endpoint + wss_endpoint)
        → 订阅 SSE /config/stream?machine_id=<instance>-gw
           ├── wg_config        → wg set peer(diff apply)
           ├── routing_config   → 写 routes.yml(traefik auto-reload)
           └── acl_projection   → 装 ACL(用于 /client ingress 预拒)
```

**健康协议**:
- `GET /ready` — Docker healthcheck,返回 `"ok"`
- `GET /server-pubkey` — 返回 base64 pubkey,供 NSD 校验一致性
- `POST /admin/shutdown` — **测试专用**,强制退出;生产**必须禁用**

NSGW 是**被动**的:没有"心跳从 NSGW 主动推给 NSD"——NSD 侧做存活探测。

## 6. 多区域部署

**部署拓扑**(参见 [09 · multi-region.md](../09-nsgw-gateway/multi-region.md)):

- 每个 NSGW 是**独立进程**,只跟 NSD 对话;NSGW 之间不互相知道对方存在
- "哪个用户走哪个 NSGW"的决策由**客户端侧**(NSN / NSC)的 `MultiGatewayManager` 做(`crates/connector/src/multi.rs:270-277`)

**NSN 侧的三种选路策略**:

| 策略 | 定义位置 | 适用场景 |
| ---- | -------- | -------- |
| `LowestLatency`(默认) | `multi.rs:87` | 常规生产,按探测 RTT 选最低 |
| `RoundRobin` | `multi.rs:89` | 测试场景 |
| `PriorityFailover` | `multi.rs:91` | 明确主备 |

**Gateway 状态机**(`connector/multi.rs:49-61`):`Pending` → `Connected` → (`Reconnecting` / `Failed` / `Disabled`)。状态变化通过 `GatewayEvent` 广播给监控面(`/api/gateways`)。

**两层 fallback 正交**:
1. **网关级**:NSGW-1 整体挂 → 切 NSGW-2(`MultiGatewayManager`)
2. **传输级**:NSGW-1 UDP 不通但 TCP 通 → 对该 NSGW 用 WSS(`ConnectorManager::connect()`)

**关键时间参数**:
- UDP 探测超时 5s(`connector/src/lib.rs:241`,`probe_udp`)
- `MultiGatewayManager::health_interval = 30s`(`multi.rs:176`)——**注意**:当前被 `#[allow(dead_code)]` 遮蔽,见 [bugs.md](./bugs.md#arch-004--func-007--multigatewaymanager-健康检查未真正定时执行)

## 7. 配置变量一览(mock)

| ENV | 默认 | 说明 |
| --- | ---- | ---- |
| `INSTANCE_ID` | `nsgw-1` | gateway_id,也是 hostname 标识 |
| `WG_PORT` | `51820` | wg0 UDP listen |
| `WSS_PORT` | `9443` | Bun WSS 端口;生产应放 443 |
| `KEY_API_PORT` | `9091` | Bun 健康 API |
| `CONTROL_CENTERS` | `""` | 逗号分隔的 NSD base URL(支持多个) |
| `ENABLE_WSS_RELAY` | `false` | 关则不启动 WSS,仅做 WG 网关 |
| `CONNECTOR_PUBKEY_HEX` | `""` | 可选,启动时预挂单个 NSN peer |

## 8. NSGW 的边界:不是什么

为避免把 NSD 职责误分配给 NSGW:

1. **不认证**——不校验 JWT、不发 token;NSD 做
2. **不合并策略**——NSN 侧的 `MultiControlPlane` 才做
3. **ACL 非权威**——NSN 内 `AclEngine` 终决;NSGW 只做 projection 预拒
4. **不维护应用层状态**——HTTPS 由 traefik 终结;WSS 只做字节中继
5. **不分虚拟 IP**——`127.11.x.x` 是 NSC 概念;`10.0.0.x` 由 NSD 分

NSGW 只知道两件事:"这个公钥对应这段 `allowed-ips`" 和 "这个 domain 对应那个 `nsn_wg_ip:virtual_port`"——其余全来自 NSD SSE(`tests/docker/nsgw-mock/src/index.ts:201-292`)。

## 9. 关键文件地图

| 文件 | 职责 |
| ---- | ---- |
| `tests/docker/nsgw-mock/src/index.ts` | 主入口:Bun.serve × 2,启动健康 API + WSS + SSE |
| `tests/docker/nsgw-mock/src/config.ts` | env → Config |
| `tests/docker/nsgw-mock/src/wg-setup.ts` | `wg set wg0 peer ...` CLI 包装 |
| `tests/docker/nsgw-mock/src/wss-relay.ts` | WsFrame 解析 + 会话缝合 |
| `tests/docker/nsgw-mock/src/traefik-config.ts` | `routing_config` → `routes.yml` |
| `tests/docker/nsgw-mock/traefik.yml` | entryPoints 静态配置 |
| `tests/docker/nsgw-mock/entrypoint.sh` | WG + TLS + traefik + bun 串联 |
| `tests/docker/docker-compose.nsgw.yml` | 双 NSGW compose(HA 示例) |
| `tmp/gateway/main.go` | gerbil 生产参考(Go 1317 行) |
| `tmp/gateway/relay/relay.go` | UDP 中继 + hole punch |
| `tmp/gateway/proxy/proxy.go` | SNI 代理 + `localSNIs` 白名单 |

---

更详细的描述见原章节:

- [09 · index](../09-nsgw-gateway/index.md) · NSGW 总览 + 读者路径
- [09 · responsibilities](../09-nsgw-gateway/responsibilities.md) · 四条核心职责的输入/输出/代码位置
- [09 · wg-endpoint](../09-nsgw-gateway/wg-endpoint.md) · kernel WG 设置、peer 同步、与 NSN 用户态对比
- [09 · wss-relay](../09-nsgw-gateway/wss-relay.md) · WSS 会话模型、连接器↔客户端缝合、fallback
- [09 · traefik-integration](../09-nsgw-gateway/traefik-integration.md) · traefik v3 能力、EntryPoints、TLS store、dynamic file provider
- [09 · multi-region](../09-nsgw-gateway/multi-region.md) · 多区域部署、选路、failover 时序
- [09 · deployment](../09-nsgw-gateway/deployment.md) · mock vs 生产差异,启动顺序,故障排查
