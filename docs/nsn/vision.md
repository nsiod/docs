# NSN · 远景与演进

> 本页是 [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 中**与 NSN 相关**的演进能力汇总。
>
> docs/11 的主线是 NSD / NSGW 的生产化,但凡涉及"控制面契约新增 / 数据面新形态",NSN 都必须配合改造,本页就是这些 NSN 配合点的索引。

## 1. 演进总纲

NSIO 的独立价值主张(参见 [11 · index §愿景陈述](../11-nsd-nsgw-vision/index.md#愿景陈述)):

1. **多 NSD 并行** — 同一 NSN 可同时向多个 NSD 注册,策略按 `resource_id` 合并去重(`crates/control/src/merge.rs:56`)。
2. **协议可插拔的控制面** — SSE / Noise / QUIC 三套传输共用一个事件解析器,无需 bootstrap 切换。
3. **`.ns` 命名空间 + 127.11.x.x VIP** — 不需要 TUN / 不需要管理员权限,客户端即插即用。
4. **代理即 NAT** — 站点侧不改 IP 头,只做端口→服务查找;ACL 是"仅允许",默认拒绝,合规审计友好。

这些是 NSN 必须保留的语义。其余 (多租户、RBAC、IdP、Webhook、Web UI、CLI、Terraform provider、多区域网关、DDoS 防护、边缘发现……) 是行业共同底线。

## 2. NSN 的三种演进形态

| 形态 | 场景 | 现状 | 演进目标 |
| --- | --- | --- | --- |
| **数据中心 NSN** | 企业内网 / 自建 IDC,固定网络 | 现有形态 | + 多路径(MPTCP / WG+WSS 并行)、+ BBR / FEC、+ 跨云 |
| **边缘 NSN** | CDN PoP / IoT gateway / 企业分支 | 不支持无头 provisioning | + provisioning key 自动注册、+ edge 缓存 / 计算、+ 离线缓冲 |
| **移动 / 嵌入式 NSN** | 笔记本休眠唤醒 / IoT 间歇通信 | 不支持低功耗心跳 | + 动态 keepalive、+ 断点续连、+ Wakelock 优化 |

详见 → [11 · data-plane-extensions D5/D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d5-边缘计算结合-nsn-at-the-edge)

## 3. 数据面演进 · NSN 配合点

| 能力 | NSN 改造 | 落地级别 | 原文 |
| --- | --- | --- | --- |
| **D1 · P2P 直连(NAT 穿透)** | 上报 NAT 类型 / 端口探测;打洞成功后绕开 NSGW 直连 | GA / 企业级 | [D1](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d1-p2p-直连-nat-穿透) |
| **D2 · 多路径(MPTCP / WG+WSS 并行)** | `MultiGatewayManager` 扩展为并行选路;packet scheduler 支持 redundant / min-rtt | GA / 企业级 | [D2](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d2-多路径-mptcp--wgwss-并行) |
| **D3 · BBR/CUBIC 拥塞控制可选** | WSS 模式下 per-socket setsockopt 切 CC | GA | [D3](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d3-拥塞控制-bbr--cubic-可选) |
| **D4 · FEC 前向纠错** | WsFrame 新增 `Fec { group_id, k, n }` 类型;丢包敏感应用受益 | 企业级 | [D4](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d4-前向纠错-fec) |
| **D5 · Edge NSN** | 无头部署(provisioning key 自动注册);edge 缓存 / 简单策略本地执行 | 企业级 | [D5](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d5-边缘计算结合-nsn-at-the-edge) |
| **D6 · 移动 / IoT 优化** | 动态 keepalive;会话 ID 持久化断点续连;低功耗 push notification | GA / 企业级 | [D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d6-iot--移动端优化) |
| **D7 · 跨云统一控制面 + 数据面** | NSN 跑在各云 VPC 内;GeoDNS 选最近 NSGW;Private Link 对接 | 企业级 | [D7](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d7-跨云统一控制面--数据面) |
| **D8 · 私有 DNS / 企业 AD 集成** | NSC 配 split DNS,但 NSN 侧需处理 `.corp` → 内部 IP 解析 | GA | [D8](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d8-私有-dns-与企业-ad-集成) |
| **D9 · BYO-CA(客户自带 CA)** | `machinekey` 改为 X.509 证书;NSN 验证链 | 企业级 | [D9](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d9-客户自带-ca-byo-ca) |
| **D10 · 硬件加速** | AES-NI(已有);可选 SmartNIC / DPU offload;eBPF 路由 | 企业级 | [D10](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d10-硬件加速) |

## 4. 控制面演进 · NSN 配合点

NSD 生产化会新增一批契约,NSN 需要相应实现 client / server 端:

| 新契约 | 方向 | NSN 角色 | 支撑能力 | 原文 |
| --- | --- | --- | --- | --- |
| `POST /api/v1/machine/posture` | NSN → NSD | 上报设备状态(OS / 磁盘加密 / 2FA) | 条件策略 | [C2 · 设备 Posture](../11-nsd-nsgw-vision/control-plane-extensions.md#能力-c2-设备-posture) |
| SSE `policy_version` | NSD → NSN | NSN 用版本号判断是否需要重载 ACL | F2.2 ACL 版本化 | [C1 · 策略 DSL](../11-nsd-nsgw-vision/control-plane-extensions.md#能力-c1-策略-dsl) |
| SSE `gateway_drain` | NSD → NSN | 通知"网关 X 即将下线",提前迁移流量 | G4.2 / G4.3 热升级 | [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) |
| SSE `ca_bundle_update` | NSD → NSN | 证书包热更新 | F1.1 Machine PKI | [11 · nsd-vision F1.1](../11-nsd-nsgw-vision/nsd-vision.md) |
| `POST /api/v1/events` | NSN → NSD | 通用事件上报(连接 / 错误 / 安全事件) | F5.10 事件总线 | [C8 · 事件总线](../11-nsd-nsgw-vision/control-plane-extensions.md) |
| `POST /api/v1/billing/ingest` | NSGW(非 NSN) | NSN 不直接出账,但 NSGW 上报含 NSN 维度 tag | F5.13 计费 | — |

详见 → [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md)

## 5. 策略表达力演进 · NSN 视角

| 演进 | 现状 | MVP | GA | 企业级 | NSN 配合 |
| --- | --- | --- | --- | --- | --- |
| ACL 下发(SSE) | ✅ | ✅ | ✅ | ✅ | 已有 |
| ACL 合并(`resource_id`) | ✅ | ✅ | ✅ | ✅ | 已有(待修 ARCH-002) |
| ACL 版本号 | ❌ | ❌ | ❌ | ✅ | NSN 需要按版本号缓存策略;支持 rollback |
| 策略 DSL(类 Rego / HuJSON) | ❌ | ❌ | ❌ | ✅ | NSN 不接 DSL,只接编译后的内部表示 |
| 策略仿真(historical replay) | ❌ | ❌ | ❌ | ✅ | NSN 上报连接日志(NSGW 也上报) |
| 策略测试工具 | ❌ | ❌ | ❌ | ✅ | NSN 暴露 `/api/acl/simulate?subject=X&target=Y` |
| 路由优先级 | ❌ | ❌ | ❌ | ✅ | `routing_config` 增加 priority 字段;`MultiGatewayManager` 据此排序 |
| 条件 DNS | ❌ | ❌ | ❌ | ❌ | 远期 |
| Ingress / Egress 策略 | ❌ | ❌ | ❌ | ✅ | NSN 已是 ingress 主战场;egress 需引入新 ACL 维度 |

详见 → [11 · feature-matrix · 策略与编排](../11-nsd-nsgw-vision/feature-matrix.md#策略与编排-nsd-f2x)

## 6. 可观测性演进 · NSN 视角

参见 [10 · OBS 缺陷清单](./bugs.md#5-可观测性-obs--12-条) + [11 · feature-matrix · 可观测性](../11-nsd-nsgw-vision/feature-matrix.md);目标是把 NSN 的运行时可观测性做到生产 SaaS 级别:

- **结构化 trace**:每个连接有 trace_id,跨 NSC → NSGW → NSN → 上游服务的 span 串联
- **per-service histogram**:连接建立时延 / 字节吞吐 / 错误率
- **审计事件流**:所有 ACL deny / auth fail / config rollback 通过独立 file/syslog sink 输出
- **SLI/SLO 文档**:可用性 / 时延 / 吞吐三个维度,4 个核心 SLI
- **NSC 也暴露 /metrics**:与 NSN 对称(目前 OBS-010 标记)

## 7. 移动端 / 边缘形态 · NSN 的天然优势

来自 [11 · data-plane-extensions D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d6-iot--移动端优化):

> NSIO 的 **127.11.x.x VIP + 本地 DNS** 模型非常适合移动端 — 不需要 TUN 权限,Android 可运行在普通 App 沙箱里(借助 SOCKS / HTTP CONNECT);iOS 可作为普通 App 而非 VPN Extension。这是**重要的差异化**,移动端对权限要求越低越好。

虽然这是 NSC 侧的优势,但在 NSN 视角:

- **NSN 也不需要 TUN 权限**(`--data-plane userspace` 默认),意味着可以跑在不能拿 root 的环境(企业笔记本作为本地服务暴露端、CI runner、容器内、Android App 沙箱)
- **NSN 可以是任何"被访问"端点**,不限于服务器形态;移动设备暴露本地 HTTP 服务给企业内网就是合法用例
- **edge NSN** 在 CDN PoP 或 IoT gateway 上无头部署,流量先在 edge 终结再经 NSGW 进入 backbone

## 8. 不在路线图内的事项(明确放弃 / 延后)

来自 [10 · roadmap §5](../10-nsn-nsc-critique/roadmap.md#5-不在路线图内的事项明确放弃--延后):

| 事项 | 理由 |
| --- | --- |
| FUNC-006 IPv6 全栈支持 | 单独 milestone(>=15 人日);先把 v4 体系打稳 |
| 控制面 GraphQL/gRPC 升级 | 没有需求驱动 |
| 把 NSD 也纳入仓库管理 | 跨服务,超出 NSN/NSC 范围 |
| WG 协议升级(如改 WG2/Boring) | gotatun 已可用,性能改造优先级低于 D/G |
| 完整 chaos engineering 框架 | 投入产出比低 |
| 把 ACL 改为 OPA / Cedar | 表达力够用,引入新依赖维护成本高 |

---

更详细的能力建模与分级落地见原章节:

- [11 · index](../11-nsd-nsgw-vision/index.md) · 愿景陈述与读者导航
- [11 · methodology](../11-nsd-nsgw-vision/methodology.md) · 能力建模、功能分级、竞品调研口径
- [11 · nsd-capability-model](../11-nsd-nsgw-vision/nsd-capability-model.md) · NSD 六大能力轴
- [11 · nsd-vision](../11-nsd-nsgw-vision/nsd-vision.md) · NSD 50+ 功能 × 价值/挑战/落地级别
- [11 · nsgw-capability-model](../11-nsd-nsgw-vision/nsgw-capability-model.md) · NSGW 六大能力轴
- [11 · nsgw-vision](../11-nsd-nsgw-vision/nsgw-vision.md) · NSGW 40+ 功能预测
- [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md) · 跨组件控制面新能力
- [11 · data-plane-extensions](../11-nsd-nsgw-vision/data-plane-extensions.md) · 跨组件数据面新能力
- [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) · 60+ 功能 × 7 列对比
- [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md) · 生产部署形态 + SLA
- [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) · MVP → GA → 企业级 分期交付
