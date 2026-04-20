# NSC · 远景与演进

> 本页是 [`docs/11-nsd-nsgw-vision/`](../11-nsd-nsgw-vision/index.md) 中**与 NSC 相关**的演进能力汇总。
>
> docs/11 的主线是 NSD / NSGW 的生产化,但凡涉及"控制面契约新增 / 数据面新形态",NSC 都必须配合改造,本页就是这些 NSC 配合点的索引。

## 1. 演进总纲

NSIO 在客户端侧的独立价值主张:

1. **无需 TUN 权限即可使用** — 默认 `userspace` 模式,`127.11.x.x` 环回 VIP + 本地 DNS,普通用户 App 沙箱可跑(Android / iOS / Docker 容器 / CI runner)。
2. **`.ns` 命名空间 + 稳定域名、易变 VIP** — 应用绑域名不绑 VIP,重启后 VIP 可变但域名稳定。
3. **HTTP CONNECT 入口** — 浏览器 / git / curl / docker 等工具链可通过 `http_proxy` 无改造接入。
4. **WSS-first** — 默认走 TCP 443,穿透严格防火墙;UDP/WG 是可选优化,不是前提。

这些是 NSC 必须保留的语义。其余(移动端 SDK、SOCKS5、PAC、设备 Posture 上报、BYO-CA 等)是行业共同底线。

## 2. NSC 的三种部署形态

| 形态 | 场景 | 现状 | 演进目标 |
| --- | --- | --- | --- |
| **开发者桌面 NSC** | 笔记本 / 工作站,长跑后台 daemon | 现有形态(userspace + 本地 DNS + HTTP 代理) | + systray UI + 诊断面板 + 自动更新 |
| **CI/自动化 NSC** | GitHub Actions / GitLab Runner / Buildkite | userspace 可用但无 device-flow / 无 status | + 无头注册(provisioning key)+ ephemeral token + `nsc status` JSON |
| **移动 NSC** | iOS / Android 应用内嵌或 VPN extension | 不支持 | + Network Extension / VpnService 集成 + 低功耗心跳 + Wakelock 优化 |

详见 → [11 · data-plane-extensions D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d6-iot--移动端优化)

## 3. 数据面演进 · NSC 配合点

| 能力 | NSC 改造 | 落地级别 | 原文 |
| --- | --- | --- | --- |
| **D1 · P2P 直连(NAT 穿透)** | 上报 NAT 类型 / 端口探测;打洞成功后绕开 NSGW 直连对端 NSN | GA / 企业级 | [D1](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d1-p2p-直连-nat-穿透) |
| **D2 · 多路径(MPTCP / WG+WSS 并行)** | NSC 可并行打开多条 WSS / WG 隧道;packet-level scheduler 选最短 RTT 或冗余 | GA / 企业级 | [D2](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d2-多路径-mptcp--wgwss-并行) |
| **D3 · BBR/CUBIC 拥塞控制可选** | WSS 模式下 per-socket setsockopt 切 CC,特别是移动端弱网 | GA | [D3](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d3-拥塞控制-bbr--cubic-可选) |
| **D4 · FEC 前向纠错** | WsFrame 新增 `Fec { group_id, k, n }`;VoIP / 视频流 NSC 侧受益 | 企业级 | [D4](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d4-前向纠错-fec) |
| **D6 · IoT / 移动端优化** | 动态 keepalive(WiFi 25s / 4G 60s);会话 ID 持久化断点续连;Wakelock 优化;iOS NetworkExtension / Android VpnService 集成 | GA / 企业级 | [D6](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d6-iot--移动端优化) |
| **D7 · 跨云统一控制面** | NSC 用 GeoDNS 选最近的 NSGW;支持 Private Link 直连 VPC | 企业级 | [D7](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d7-跨云统一控制面--数据面) |
| **D8 · 私有 DNS / 企业 AD 集成** | NSC 本地 DNS resolver 可配 split DNS;`.corp` 优先上游企业 AD,`.n.ns` 仍走 NSC | GA | [D8](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d8-私有-dns-与企业-ad-集成) |
| **D9 · BYO-CA(客户自带 CA)** | `machinekey` 改为 X.509 证书链;NSC 端验证 + 签名 | 企业级 | [D9](../11-nsd-nsgw-vision/data-plane-extensions.md#能力-d9-客户自带-ca-byo-ca) |

## 4. 控制面演进 · NSC 配合点

NSD 生产化会新增一批契约,NSC 需要相应实现 client 端:

| 新契约 | 方向 | NSC 角色 | 支撑能力 | 原文 |
| --- | --- | --- | --- | --- |
| `POST /api/v1/machine/posture` | NSC → NSD | 上报设备状态(OS / 磁盘加密 / 2FA / 防病毒) | 条件策略 / 零信任接入 | [C2 · 设备 Posture](../11-nsd-nsgw-vision/control-plane-extensions.md#能力-c2-设备-posture) |
| SSE `policy_version` | NSD → NSC | 按版本号判断是否需要重载 ACL(NSC 启用 `_acl_rx` 后) | F2.2 ACL 版本化 | [C1 · 策略 DSL](../11-nsd-nsgw-vision/control-plane-extensions.md#能力-c1-策略-dsl) |
| SSE `gateway_drain` | NSD → NSC | 通知"网关 X 即将下线",NSC 迁移到其他 gateway | G4.2 / G4.3 热升级 | [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) |
| SSE `ca_bundle_update` | NSD → NSC | 证书包热更新(BYO-CA 时) | F1.1 Machine PKI | [11 · nsd-vision F1.1](../11-nsd-nsgw-vision/nsd-vision.md) |
| `POST /api/v1/events` | NSC → NSD | 通用事件上报(连接错误 / ACL 拒绝 / 用户提示) | F5.10 事件总线 | [C8 · 事件总线](../11-nsd-nsgw-vision/control-plane-extensions.md) |
| OAuth2 device-flow(现已存在,NSC 未接) | NSC → NSD | 无 `--auth-key` 场景的交互式登录 | MVP | [FUNC-002](../10-nsn-nsc-critique/functional-gaps.md#func-002) |
| Provisioning key(无头注册) | NSC → NSD | CI runner / 容器镜像内预置短 key → 首次启动注册 | F3.10 机器注册 | [11 · nsd-vision](../11-nsd-nsgw-vision/nsd-vision.md) |

详见 → [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md)

### 设备 Posture(NSC 特有)

来自 [11 · control-plane-extensions C2](../11-nsd-nsgw-vision/control-plane-extensions.md#能力-c2-设备-posture):

```json
{
  "machine_id": "nsc-alice-laptop",
  "os": "macOS 14.3",
  "disk_encrypted": true,
  "firewall_enabled": true,
  "mfa_enrolled": true,
  "antivirus_active": true,
  "device_posture_score": 0.95
}
```

NSC 侧要求:
- **采集器**:定期(30s)扫描本地状态,平台相关(macOS/Linux/Windows)
- **上报**:`POST /api/v1/machine/posture`,签名与 heartbeat 一致
- **本地缓存**:posture 在内存,供 `nsc status` 展示
- **UX**:用户可见"为什么被拒"(例:"磁盘加密未启用")

## 5. 出站 ACL / 策略表达力 · NSC 视角

参见 [bugs.md SEC-006 / FUNC-012](./bugs.md#sec-006) + [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md):

| 演进 | 现状 | MVP | GA | 企业级 | NSC 配合 |
| --- | --- | --- | --- | --- | --- |
| 出站 ACL 预检(VIP / HTTP proxy 入口) | ❌ | ✅ | ✅ | ✅ | 消费 `_acl_rx`,`acl::AclEngine` 加到 `resolve` 路径 |
| 客户端侧 ACL 与服务端 NSN ACL 差异容忍 | ❌ | ✅ | ✅ | ✅ | "客户端预检放行但服务端拒绝"视为正常,不告警 |
| 策略 DSL(类 Rego / HuJSON) | ❌ | ❌ | ❌ | ✅ | NSC 不接 DSL,只接编译后内部表示 |
| 策略仿真(测试模式) | ❌ | ❌ | ❌ | ✅ | NSC 暴露 `/api/acl/simulate?target=...`(与 /metrics 同端口) |
| 用户提示(UX) | ❌ | ❌ | ✅ | ✅ | ACL 拒绝时 HTTP 代理返回 403 + 易读 body,VIP listener 返回 RST |
| 条件 DNS(按 posture) | ❌ | ❌ | ❌ | ❌ | 远期 |

## 6. HTTP 代理演进

当前实现足够应对浏览器 + 命令行工具,但还有几条明显短板:

| 演进 | 当前 | 目标 |
| --- | --- | --- |
| CONNECT + 明文 HTTP | ✅ | + SOCKS5 入口(部分工具不支持 HTTP_PROXY) |
| PAC 文件自动配置 | ❌ | + 生成 PAC `function FindProxyForURL(...)`,浏览器按域匹配 |
| 非 `.n.ns` 企业域 | 未命中即走 OS 直连 | + 企业域名规则(从 `dns_config` 下发,走 NSGW/NSN) |
| 认证 | 无 | + HTTP Basic / 挑战响应,防止本机其他用户用该代理 |
| IPv6 字面地址 `[::1]` | CONNECT 支持,明文 GET 不支持 | 明文 GET 补 `[...]` 解析 |
| 双协议绝对 URI(`https://...` 进代理) | 半支持(按 HTTP 透传,不 TLS) | 明确拒绝 + 提示用 CONNECT |

## 7. 可观测性演进 · NSC 视角

参见 [bugs.md OBS-010](./bugs.md#obs-010) + [11 · feature-matrix · 可观测性](../11-nsd-nsgw-vision/feature-matrix.md);目标是把 NSC 运行时可观测性做到与 NSN 对称的最低水平:

- **`127.0.0.1:9091/metrics`** 暴露:
  - `nsc_dns_queries_total{qtype,result}`
  - `nsc_vip_ports_active{mode}`
  - `nsc_nsgw_rtt_seconds{gateway_id}` (histogram)
  - `nsc_proxy_connections_active{entry="vip|http"}`
  - `nsc_ws_reconnects_total{reason}`
  - `nsc_acl_denials_total{reason}`(依赖 A.6)
- **`nsc status`** 子命令走 UNIX socket / HTTP,输出 sites / vips / dns / gateways / rtt
- **结构化 trace**:每个连接带 `trace_id`,`copy_bidirectional` 的 span 与 NSN 侧贯通(跨进程 SpanContext 传递)
- **审计事件流**:本地 file / syslog,记录"出站 ACL 拒绝 / token 刷新失败 / DNS forward 超时"

## 8. 移动端 / 边缘形态 · NSC 的天然优势

来自 [11 · data-plane-extensions D6 与 NSIO 独立主张](../11-nsd-nsgw-vision/data-plane-extensions.md#与-nsio-独立主张的配合):

> NSIO 的 **127.11.x.x VIP + 本地 DNS** 模型非常适合移动端 — 不需要 TUN 权限,Android 可运行在普通 App 沙箱里(借助 SOCKS / HTTP CONNECT);iOS 可作为普通 App 而非 VPN Extension。这是**重要的差异化**,移动端对权限要求越低越好。

移动 NSC 具体路径:

- **iOS 普通 App**(非 Network Extension):HTTP 代理 + 应用内指向 `127.0.0.1:8080`;用户感知等同"设置 → 代理"
- **iOS Network Extension**(需 VPN entitlement):完整 NSC,系统级流量拦截
- **Android 普通 App**:SOCKS5 / HTTP CONNECT 入口给其他 App 引用
- **Android VpnService**:完整 NSC,系统级 TUN
- **RTOS / IoT**:裁剪版 NSC(仅 HTTP 代理 + 最小控制面),无 DNS server

## 9. 客户端产品化(超出 docs/11 范围,但路线图必提)

| 功能 | 当前 | 目标 |
| --- | --- | --- |
| systray UI | ❌ | Tauri / Electron wrapper;状态图标 + 菜单快捷切换 realm |
| 自动更新 | ❌ | TUF-style 签名更新;支持 staged rollout |
| 首次启动引导 | ❌ | 启动后弹窗"粘贴 user_code 或扫码"(配合 device-flow) |
| 诊断面板 | ❌ | 内嵌 `nsc status` 网页 + 复制诊断包(日志 + 配置脱敏)一键提交 |
| 企业 MDM 下发 | ❌ | macOS `.mobileconfig` / Windows Intune / Android MDM JSON 模板 |

## 10. 不在路线图内的事项(明确放弃 / 延后)

来自 [10 · roadmap §5](../10-nsn-nsc-critique/roadmap.md#5-不在路线图内的事项明确放弃--延后):

| 事项 | 理由 |
| --- | --- |
| NSC IPv6 完整支持(AAAA 命中 + VIP 段 v6) | 跟 NSN 同步做;单独 milestone(>=15 人日) |
| NSC 作为完整 SOCKS5 认证服务 | HTTP CONNECT 已覆盖 80% 场景 |
| NSC 原生 TUN 模式 | 等 D.4(多 TCP WSS)稳定后再评估;当前优先把 `tun` 占位选项改为"删或真做"的二选一 |
| NSC 做 MITM / TLS 拦截 | 与零信任客户端语义矛盾,永久放弃 |
| NSC 内嵌 QUIC transport | 暂无场景驱动(`--control-mode quic` 已在栈里,但 NSC CLI 未暴露) |

---

更详细的能力建模与分级落地见原章节:

- [11 · index](../11-nsd-nsgw-vision/index.md) · 愿景陈述与读者导航
- [11 · methodology](../11-nsd-nsgw-vision/methodology.md) · 能力建模、功能分级、竞品调研口径
- [11 · control-plane-extensions](../11-nsd-nsgw-vision/control-plane-extensions.md) · 跨组件控制面新能力
- [11 · data-plane-extensions](../11-nsd-nsgw-vision/data-plane-extensions.md) · 跨组件数据面新能力
- [11 · feature-matrix](../11-nsd-nsgw-vision/feature-matrix.md) · 60+ 功能 × 7 列对比
- [11 · operational-model](../11-nsd-nsgw-vision/operational-model.md) · 生产部署形态 + SLA
- [11 · roadmap](../11-nsd-nsgw-vision/roadmap.md) · MVP → GA → 企业级 分期交付
