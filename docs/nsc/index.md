# NSC · 用户客户端全景

> **NSC (Network Site Client)** —— NSIO 生态在用户侧的运行时二进制。它把远端 NSN 站点上的服务"拉到本地",用户看到的是几个 `127.11.x.x` 的环回 IP 和一串 `*.n.ns` 域名,`ssh` / `curl` / `psql` 可以像访问本机服务一样访问远端。
>
> 本目录是 **NSC 主题门户**:把分散在 `docs/06-nsc-client`、`docs/10-nsn-nsc-critique`、`docs/11-nsd-nsgw-vision` 中的 NSC 相关内容(功能 / 缺陷 / 远景 / 路线)汇总到一处,方便按视角查阅。原章节保持不变,本目录是它们的二次组织。

## 1. NSC 是什么

- **位置**: 用户终端(开发者笔记本 / CI runner / 企业办公机 / 移动 App 宿主)。和站点侧的 NSN (`docs/07-nsn-node/`) 对称,但承担的是"访问端"职责。
- **入站**: 通过 control 面 (SSE 默认) 从 NSD 拉取 `routing_config / gateway_config / dns_config` 事件(另外 4 路 `wg/proxy/acl/token_refresh` 接收器目前被显式丢弃,见 [bugs §8](./bugs.md#8-半成品--dead_code-一览))。
- **出站**: `127.11.x.x:port` 上 `TcpListener` 监听 → `NscRouter::resolve` → 打开一条 WSS `CMD_OPEN_V4` 到主 NSGW → NSGW 中转到远端 NSN → 对端本地服务。可选 `--http-proxy` 为浏览器提供 HTTP/CONNECT 入口。
- **身份**: 复用 `common::MachineState`(Ed25519 + X25519),state dir 默认 `/var/lib/nsio-nsc`,registrations 按 realm 分文件。
- **代码**: `crates/nsc/` 6 个 `.rs` 文件 ≈ 1,860 行(含测试),与 NSN 共享 `common / control / auth / acl / tunnel-wg / tunnel-ws / transport / proxy / telemetry`。

完整组件全景见 [01 · 系统总览](../01-overview/index.md);本门户聚焦 NSC 视角。

## 2. 四个视角入口

| 文档 | 你想了解 | 主要来源 |
| ---- | -------- | -------- |
| [features.md](./features.md) | NSC **当前能做什么** —— CLI / VIP / DNS / Router / Proxy / HTTP 代理 / 三种数据面模式 | [`docs/06-nsc-client/`](../06-nsc-client/index.md) 5 篇 |
| [bugs.md](./bugs.md) | NSC **当前有什么坑** —— `--data-plane tun` 假 TUN、`--device-flow` 未实现、`_token_rx` 被丢弃、无出站 ACL、无 /metrics 等 | [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 中 NSC-only 条目 |
| [vision.md](./vision.md) | NSC **未来要做什么** —— 出站 ACL / 客户端 posture / HTTP 代理演进 / 移动端 / P2P / 多路径 / 私有 DNS | [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 跨组件扩展 |
| [roadmap.md](./roadmap.md) | NSC 改造**应该按什么顺序**做 —— Phase 0 紧急止血(Token 刷新、ACL 接管、诚实的 CLI)+ Phase 1~7 依赖 | [`docs/10-nsn-nsc-critique/roadmap.md`](../10-nsn-nsc-critique/roadmap.md) + [`docs/11-nsd-nsgw-vision/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md) |

## 3. 一屏速览

| 维度 | 现状 (HEAD 2026-04-16) | 远景 (生产级) |
| ---- | ---------------------- | ------------- |
| 数据面模式 | userspace(默认,`127.11/16`)、wss(与 userspace 等价)、tun(**仅换前缀,未建 TUN**) | userspace + 真 TUN + WSS 严格模式 + P2P 直连 |
| VIP 分配 | 内存 HashMap,无持久化,`/16` 顺序分配,site 名字幂等 | + 持久化缓存 + 稳定 VIP ↔ site 映射 |
| 本地 DNS | `127.53.53.53:53` 默认监听,命中 `*.n.ns` / `dns_config`,未命中转发 `1.1.1.1` | + split DNS(企业 `.corp`)+ 上游可配置 + AAAA 支持 |
| SSE 消费 | 仅消费 3 路:`routing / gateway / dns`;其余 4 路(`wg/proxy/acl/token_refresh`)显式丢弃 | 全部 8 路消费;ACL 出站预检;token 轮转生效 |
| 出站 ACL | **无**,完全依赖 NSN / NSGW 兜底 | 双层:客户端预检(立即反馈)+ 服务端权威 |
| HTTP 代理 | `--http-proxy 127.0.0.1:8080` 可选;命中域直连 WSS(绕过 VIP listener) | + SOCKS5 + PAC 自动配置 + 非 n.ns 的企业域名规则 |
| 认证 | `--auth-key` 多 realm;`--device-flow` **bail**("未实现") | device-flow 复用 `device_flow` crate;token 加密落盘 |
| 状态 CLI | `nsc status` 只 `println!` 占位 | UNIX socket / HTTP 暴露 sites / vips / dns / tunnel 状态 |
| 可观测性 | 无 `/metrics` 端点;无 OTel pipeline | `127.0.0.1:9091/metrics` 暴露 dns / vip / nsgw_rtt / ws_reconnects |
| IPv6 | 不支持 AAAA 命中 | 待立项(跟 NSN IPv6 同步) |

## 4. 关键文件 (NSC 源码地图)

| 文件 | 行数 | 职责 |
| ---- | ---- | ---- |
| `crates/nsc/src/main.rs` | ~300 | CLI 解析、`run()` 装配、主循环 `select!` |
| `crates/nsc/src/vip.rs` | ~120 | `VipAllocator` 段选择 + 顺序分配 + 幂等 |
| `crates/nsc/src/dns.rs` | ~240 | UDP DNS 服务器 + 查询分发 + 上游转发 |
| `crates/nsc/src/router.rs` | ~170 | `NscRouter` 路由表 + 出站 NAT + lazy binding |
| `crates/nsc/src/proxy.rs` | ~200 | VIP `TcpListener` 管理 + WSS 流打开 |
| `crates/nsc/src/http_proxy.rs` | ~300 | `CONNECT` / 明文 `GET` / 目标分流 |

## 5. 与其他模块的关系

- **[01 系统总览](../01-overview/index.md)** — NSC 是 NSIO 四大组件之一,用户侧入口。
- **[02 控制面](../02-control-plane/index.md)** — NSC 复用 `ControlPlane`,通过 SSE 订阅 `routing_config` / `dns_config` / `gateway_config`;Noise / QUIC transport 理论可用但当前 NSC CLI 仅暴露 SSE。
- **[03 数据面](../03-data-plane/index.md)** — NSC `proxy.rs` 和 NSN 共用相同的 `WsFrame` 协议(`CMD_OPEN_V4` / `CMD_DATA` / `CMD_CLOSE`);TUN 模式复用 `tunnel-wg`(尚未落地)。
- **[05 Proxy / ACL](../05-proxy-acl/index.md)** — NSC 的 proxy 是**出站**方向,与 NSN 的入站代理方向相反;ACL 过滤尚未接入。
- **[NSN 门户](../nsn/index.md)** — 对称视角,两者共享栈但流量方向相反。

## 6. 本门户与原章节的关系

- **不复制内容,做组织**:本目录里所有详细描述都链接回原章节,缺陷 / 远景条目均带 `path:line` 锚点。
- **不删除原章节**:`docs/06-nsc-client/` / `docs/10/` / `docs/11/` 都被其他章节交叉引用,移动会破坏链接。
- **更新策略**:原章节内容更新时,本门户的"摘要 / 索引 / 路线"需要相应同步;缺陷修复后在 [bugs.md](./bugs.md) 标 `[RESOLVED in <hash>]`。

## 7. 推荐阅读顺序

1. **第一次接触 NSC** → [features.md §1 二进制与运行形态](./features.md#1-二进制与运行形态) → [features.md §3 数据面三模式](./features.md#3-数据面三模式)
2. **要部署 NSC** → [features.md §2 CLI 与启动](./features.md#2-cli-与启动) → [features.md §5 DNS 监听与系统集成](./features.md#5-dns-监听与系统集成)
3. **要评估生产风险** → [bugs.md §1 P0/P1 必修](./bugs.md#1-p0p1-必修)
4. **要规划演进** → [vision.md](./vision.md) → [roadmap.md](./roadmap.md)
5. **要排修复优先级** → [roadmap.md §2 Phase 拆解](./roadmap.md#2-phase-拆解)
