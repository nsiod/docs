# NSGW · 改造路线图

> 本页融合 [`docs/11/roadmap.md`](../11-nsd-nsgw-vision/roadmap.md)(NSD/NSGW 生产化 MVP → GA → 企业级)与 [`docs/10/roadmap.md §3`](../10-nsn-nsc-critique/roadmap.md#3-跨团队跨组件协调点)(NSN/NSC 跨团队协调点),只挑出**与 NSGW 直接相关**的阶段、依赖与协议契约变更。
>
> 起点锚定 2026-04-20。真实排期取决于团队规模与并行度。

## 1. 路线图总览

NSGW 的改造路线由两条主线:

```
生产化扩展 (11/roadmap)               协议契约演进 (10/roadmap §3)
──────────────────────               ─────────────────────────
Phase 0 · 当前基线 ✅                  mock (Bun) + gerbil (Go) 两份独立实现
Phase 1 · MVP (~2Q)     ────┐         + WS frame v1 + SSE v1
Phase 2 · GA (~4Q)      ────┼──→      + WS frame v2 (多 TCP + source 字段)
Phase 3 · 企业级 (~8Q)  ────┘         + SSE v2 (gateway_l4_map + authz)
                                       + Noise / MASQUE / Anycast 数据面
```

完整 Gantt → [11 · diagrams/roadmap-phases.d2](../11-nsd-nsgw-vision/diagrams/roadmap-phases.d2)

## 2. Phase 0 · 当前基线(已达成)

✅ mock (Bun + TS) 3 文件 387 行,跑通 traefik + kernel WG + WSS 会话缝合
✅ gerbil fork (Go) 1317 行,SNI proxy + UDP relay + hole punch + PROXY v1 + bandwidth report
✅ NSD SSE 契约在 mock 中可用(`wg_config` / `routing_config` / `acl_projection`)
✅ `/api/v1/machine/register` + `/api/v1/gateway/report` 握手跑通
✅ 4 套 E2E (WG/WSS/Noise/QUIC) 通过

**未达成**:mock 与 gerbil **未融合**,生产 NSGW 仍缺一份"SSE 契约 + gerbil 数据面能力"的并集代码。

完整基线对比 → [features.md §1 部署形态](./features.md#1-部署形态) · [bugs.md §2 运营空白](./bugs.md#2-运营空白从-mock--生产的工程差距)

## 3. Phase 1 · MVP(~2 季度)

### 目标

交付可被 10 个 NSN + 100 个 NSC 使用的单网关生产版本。替换 mock 的 Bun 实现为 Go (gerbil 派生),继承 NSD 的 SSE 契约。

### M1 里程碑清单

#### 数据面融合

- [ ] 基于 `tmp/gateway/` Go 代码新增 `pkg/nsd/sse_client.go`,订阅 NSD `/api/v1/config/stream`
- [ ] 替换 gerbil `/gerbil/get-config` HTTP 轮询为 SSE 推送
- [ ] 保留 gerbil 的 SNI proxy / kernel WG (wgctrl) / PROXY v1 / 内存 watchdog / hole punch
- [ ] 新增 `handleRoutingConfig` adapter,把 NSD 的 `routing_config` 翻译为 traefik dynamic file
- [ ] 新增 `handleAclProjection` adapter(WSS `/client` ingress 第一层过滤)
- [ ] `/gateway/report` 流程实现(bandwidth usage + peer online 状态)

#### 三端口标准化

- [ ] `51820/udp` WG 由 wgctrl 管理,peer 表随 SSE 事件动态增删
- [ ] `443/tcp` HTTPS 入口由 traefik 承接(MVP 保留 traefik,Phase 2 再评估 Route A/B)
- [ ] `9443/wss` WsFrame 多路复用(`/relay` + `/client`)
- [ ] 三端口均支持 `/healthz` + `/ready` + `/server-pubkey`

#### 可观测性基线

- [ ] Prometheus `/metrics` 导出(连接数 / 带宽 / peer 状态 / WSS 活跃会话)
- [ ] 结构化访问日志(JSON,含 `gateway_id` / `connection_id` / `frame_seq`)
- [ ] gerbil `periodicBandwidthCheck` → OTel counter
- [ ] pprof 保留

#### 容灾基线

- [ ] `/admin/shutdown` 支持 graceful drain(等 WSS 会话结束再退出)
- [ ] systemd / k8s liveness 自愈

### MVP 验收标准

- 单 NSGW + 单 NSD 跑 72 小时不崩
- 10 NSN + 100 NSC 能通过 NSGW 建立 WG / WSS 隧道并互通
- traefik 动态路由更新 < 5s,SSE 事件丢失后能重连补齐
- 4 套 E2E 用生产 NSGW(非 mock)全绿
- `/metrics` 至少 12 个关键 metric

### MVP 风险

| 风险 | 应对 |
| ---- | ---- |
| gerbil 的 HTTP 拉取模型与 NSIO SSE 推送不一致 | 先做 adapter 层,不直接改 gerbil 内核逻辑 |
| mock 到生产 API 漂移 | 契约测试(4 套 E2E 全套重跑) |
| Go 版本 PROXY v1 与 Rust NSN 字节 relay 互操作 | 冒烟测试覆盖 WSS + PROXY v1 组合 |
| gerbil fork AGPL license | MVP 前审查,必要时重写关键模块 |

## 4. Phase 2 · GA(~4 季度)

### 目标

卖给 100~1000 人企业客户,SLA 99.9%,3 区 Geo 就近,支持 P2P + QUIC。

### M2 里程碑清单

#### 连接能力(Transport)

- [ ] QUIC 数据面(MASQUE 前置)
- [ ] 内置 STUN server
- [ ] NSD 协同 hole punch(P2P) —— `/gateway/punch-request` 新增 SSE 事件
- [ ] PROXY Protocol v2
- [ ] mTLS 终结

#### 路由能力(Routing)

- [ ] 任意 TCP 端口映射(SSH / DB 等)—— SSE 扩展 `gateway_l4_map`
- [ ] Path-based / Header-based routing(仍依赖 traefik 或开始迁 Route A)
- [ ] 域名管理 + ACME 自动证书

#### 安全能力(Security)

- [ ] 基础限速(连接级 + 带宽)
- [ ] UDP flood 防御
- [ ] CrowdSec 对接(IP 信誉)
- [ ] WAF 基础(Coraza)
- [ ] Resource 级认证(password / pin)
- [ ] 连接数上限(per IP / per user)

#### 容灾(Resilience)

- [ ] 热升级(drain + swap)
- [ ] 蓝绿部署
- [ ] 多区域部署(≥3 区)+ GeoDNS
- [ ] 配置回滚机制

#### 观测(Telemetry)

- [ ] OTel traces 完整链路
- [ ] 实时拓扑上报 NSD
- [ ] 连接级日志 + 采样
- [ ] WSS 背压指标

#### 资源(Resource)

- [ ] 每 peer 精确带宽计量
- [ ] 每 org 配额
- [ ] 计费埋点 → NSD
- [ ] WSS 背压控制

### 架构决策点

- [ ] **Route A vs Route B 抉择** —— 决定是继续 traefik(+ 自研轻 Proxy 承担 L4)还是全面迁 Envoy + xDS
- [ ] 决策依据:客户侧域名数规模 + WAF 规则复杂度 + 团队 Go/Envoy 熟悉度
- [ ] 详见 → [vision.md §1 架构再审视](./vision.md#1-架构再审视--traefik-是否继续)

### GA 验收标准

- 3 区 NSGW,任一区失效 30 秒内 GeoDNS 切换
- 1000 节点规模下 WSS p99 转发延迟 < 50ms
- QUIC 数据面与 WG 打平(throughput 差 < 10%)
- P2P 打洞成功率 > 60%(失败 fallback WSS 中继)
- 热升级无会话中断
- WAF 基础规则集跑通

### GA 风险

| 风险 | 应对 |
| ---- | ---- |
| P2P 在复杂 NAT 下成功率低 | 保留 WSS 中继兜底;成功率持续监控 |
| 多区 NSGW 间状态同步 | 无共享状态;所有状态走 NSD |
| QUIC 在企业防火墙被挡 | 提供 MASQUE / WSS fallback 自动协商 |
| traefik 到 Route A 迁移风险 | 灰度 + 双栈并行 1 个季度 |

## 5. Phase 3 · 企业级(~8 季度)

### 目标

销售给大型企业 / 金融 / 政府,合规 + 私有化 + 定制化。

### M3 里程碑清单

#### 差异化数据面

- [ ] Noise 数据面
- [ ] MASQUE / HTTP/3 CONNECT-UDP
- [ ] Anycast IP + BGP peering
- [ ] 协议可插拔(WG / QUIC / Noise 按策略自动选)

#### 容灾 · 企业级

- [ ] 跨网关热迁移(session handoff)
- [ ] 会话状态快照
- [ ] Gateway Mesh(跨区 failover + 连接 handoff)
- [ ] A/B 测试路由

#### 安全 · 企业级

- [ ] WAF 企业规则集(OWASP CRS + 定制)
- [ ] Bot 管理
- [ ] 零信任策略点(Authz Proxy)
- [ ] DDoS L3/L4(上游对接)+ L7(challenge)

#### 性能 · 企业级

- [ ] SO_REUSEPORT 多进程
- [ ] QoS 分类(prod / dev / bulk)
- [ ] Linux tc / eBPF 整形
- [ ] 过载降级(付费 tier 优先)
- [ ] 硬件加速(eBPF / DPU)

#### 观测 · 企业级

- [ ] 采样率动态控制
- [ ] SIEM 深度对接(Splunk HEC / Sentinel)

### 企业级验收标准

- 4 区跨大洲 NSGW,单区失效 30 秒内 failover
- Anycast IP 生效,客户端无感路径切换
- 10 万节点规模下 p99 转发延迟 < 100ms
- air-gap 部署可独立运行
- WAF + DDoS 挡住常见 OWASP Top10 攻击

### 企业级风险

| 风险 | 应对 |
| ---- | ---- |
| Anycast 需要 AS 号 + BGP 对等 | 找 Cloudflare / AWS Global Accelerator 合作 |
| Session handoff 状态同步复杂 | 先实现"连接级"handoff,暂不做"应用级" |
| eBPF 在不同内核版本差异 | 限定 LTS 版本 + fallback 纯用户态 |
| 合规认证周期长(SOC2 Type 2 需 6 个月) | Phase 2 末启动,Phase 3 末拿到 |

## 6. 跨团队协调点

NSGW 的部分改造**必须与 NSD / NSN 团队协同**,不能孤立推进:

| 改造 | NSGW 改动 | NSD / NSN 配套 | 协调点 | 所处 Phase |
| ---- | --------- | -------------- | ------ | ---------- |
| SSE 推送契约 | 替换 HTTP 轮询为 SSE 订阅 | NSD 暴露 `/api/v1/config/stream` | API spec 评审 | MVP |
| 强制 https register | 支持 8443/https | NSD 开 8443;NSN reqwest scheme | 部署文档同步发布 | MVP |
| 多 TCP WSS | 多通道 frame 协议识别 | NSN 侧多通道协商 | **WS frame v2 spec** | GA |
| frame source identity | 填入 NSC 身份 | NSN 读取 source 字段 | **frame schema bump** | GA |
| ACL sentinel | `/client` 两级信任前置 | NSD 区分 "empty 是真实意图" vs "空因失败" | API 行为约定 | GA |
| L4 端口映射 | 消费 `gateway_l4_map` | NSD 新增 SSE 事件 | API spec 评审 | GA |
| Resource auth | 验证 password / pin | NSD 存储 + 下发 `authz` 事件 | API spec 评审 | GA |
| P2P hole punch | 实现 STUN + coordinated punch | NSD 新增 `punch-request` 事件 | API spec 评审 | GA |
| Billing ingest | 上报 per-peer 带宽 | NSD 新增 `/billing/ingest` | API spec 评审 | GA |
| Noise / MASQUE | 多数据面并存 | NSN 支持协议自动选 | 协议协商 spec | 企业级 |

## 7. 风险与回滚预案

| 高风险改造 | 风险 | 回滚预案 |
| ---------- | ---- | -------- |
| mock → Go 融合 | 行为差异引入回归 | mock 保留为契约测试 oracle,Go 实现通过则切换,保留 `--mock-fallback` flag 一个 release |
| SSE 替换 HTTP 轮询 | SSE 断线未补齐导致配置漂移 | 启动 `last-event-id` + full-resync 兜底 |
| 多 TCP WSS | NSN/NSGW 版本不匹配 | frame v2 协商失败回退 v1 |
| QUIC 启用 | 企业防火墙挡 UDP/443 | 自动探测 + fallback WSS |
| Route A 替换 traefik | 域名路由回归 | 双栈并行 1Q,逐个域名迁移 |
| Anycast | BGP 误配导致全球故障 | 先单 AS 单区实验 6 个月再上线 |

## 8. 监控与回顾

每个 Phase 结束必须:

1. 4 套 E2E (WG/WSS/Noise/QUIC) + 新增 Phase 专属 E2E 全绿
2. 与 Phase 之前 perf snapshot 对比(throughput / p99 / CPU / 内存)
3. 用 [bugs.md §1 P0/P1 必修](./bugs.md#1-p0--p1-必修)清单逐项验证
4. 受影响 docs 由 owner 更新;本目录(nsgw/)与 09/ 10/ 11/ 保持一致
5. 在 [bugs.md](./bugs.md) 勾掉已关闭缺陷

## 9. Phase 1 紧急行动清单(第 1 个月内)

如果只能做一件事:

1. **新建 gerbil 的 SSE adapter 层**(~3 人周),替换 `/gerbil/get-config` 轮询
2. 同步把 [bugs.md §1 P0 必修](./bugs.md#1-p0--p1-必修)发给 NSGW / NSD 联合 owner

如果有 1 个月:完成 SSE adapter + `/healthz /metrics /gateway_report` 标准化。
如果有 1 季度:完成 MVP 全部里程碑。
如果有 2 季度:进入 GA 前置(QUIC 原型 + 多区部署试点)。

## 10. NSGW 在 MVP/GA/企业级 的形态演进

| 阶段 | NSGW 形态 | 必要补齐 |
| ---- | --------- | -------- |
| **Phase 0** | mock (Bun) + gerbil (Go) **两份独立** | N/A |
| **MVP** | gerbil + SSE adapter 的**单一 Go 生产代码**;traefik 保留 | 可观测性 / 容灾基线 |
| **GA** | + QUIC + P2P + mTLS + 多区 + WAF 基础 + Route A/B 抉择 | 热升级 + GeoDNS |
| **企业级** | + Noise + MASQUE + Anycast + Gateway Mesh + session handoff | 合规认证 + 跨云 |

详见 → [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md)

---

完整路线图原文:

- [11 · roadmap.md](../11-nsd-nsgw-vision/roadmap.md) · NSD/NSGW 生产化 MVP→GA→企业级
- [11 · nsgw-capability-model.md](../11-nsd-nsgw-vision/nsgw-capability-model.md) · 六大能力轴现状 / MVP / GA / 企业级
- [11 · nsgw-vision.md](../11-nsd-nsgw-vision/nsgw-vision.md) · 40+ 功能清单 + 路线 A vs B 决策
- [10 · roadmap.md §3](../10-nsn-nsc-critique/roadmap.md#3-跨团队跨组件协调点) · 跨团队协调点(NSN/NSC 侧视角)
