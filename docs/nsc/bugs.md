# NSC · 已知缺陷与改进项

> 本页是 [`docs/10-nsn-nsc-critique/`](../10-nsn-nsc-critique/index.md) 70+ 缺陷中**与 NSC 相关**部分的精简索引。每条缺陷给出严重度、一句话症状、源码位置与原文锚点。
>
> NSN 主导的共享缺陷(影响 NSC 部署但主修复在 NSN 侧)在 §6 列出。审查依据:HEAD 2026-04-16。
>
> 字段约定:**P0** = 安全 / 可用性危及生产;**P1** = 严重影响功能或运维;**P2/P3** = 待优化。

## 1. P0/P1 必修

| ID | 一句话 | crate / 位置 | 原文 |
| --- | --- | --- | --- |
| [FUNC-001](#func-001) | `--data-plane tun` 只换 VIP 前缀,**未建 TUN 设备**(静默欺骗) | `nsc/main.rs:90-95, 199-202`, `nsc/vip.rs:18-26` | [FUNC-001](../10-nsn-nsc-critique/functional-gaps.md#func-001) |
| [FUNC-004](#func-004) | `_token_rx` 显式丢弃 → token 长跑刷新失效,`proxy_mgr` 永远 `token=""` | `nsc/main.rs:195, 227` | [FUNC-004](../10-nsn-nsc-critique/functional-gaps.md#func-004) |
| [SEC-006](#sec-006) | NSC **完全没有出站 ACL**,客户端零策略 | `nsc/main.rs:195`, `nsc/proxy.rs`, `nsc/router.rs`, `nsc/dns.rs` | [SEC-006](../10-nsn-nsc-critique/security-concerns.md#sec-006) |
| [SEC-010](#sec-010) | Token 刷新通道 `_token_rx` 被丢弃 → 凭据轮换无法对 NSC 生效 | `nsc/main.rs:195` | [SEC-010](../10-nsn-nsc-critique/security-concerns.md#sec-010) |
| [ARCH-005](#arch-005) | 主循环只 select 3 路 SSE,忽略 4 路接收器(`wg_rx/proxy_rx/acl_rx/token_rx`) | `nsc/main.rs:195-296` | [ARCH-005](../10-nsn-nsc-critique/architecture-issues.md#arch-005) |

## 2. 架构问题 ARCH

### ARCH-005 · NSC 主循环只 select 3 路 SSE 事件,忽略 4 路接收器
- **Severity**: P1
- **Location**: `crates/nsc/src/main.rs:195` 的 `let (control, _wg_rx, _proxy_rx, _acl_rx, mut gw_rx, mut routing_rx, mut dns_rx, _token_rx) = ControlPlane::new(...)`
- **现状**: `ControlPlane::new` 返回 8 路 receiver,NSC 仅消费 3 路(`gw/routing/dns`);其余 4 路显式丢弃
- **影响**: 客户端无 ACL、token 不刷新、WG 模式是 placeholder —— 这是"零信任客户端"设计的结构性缺口
- **改进**: 见 [improvements E.3 / A.6](../10-nsn-nsc-critique/improvements.md#theme-e--半成品收尾)
- **原文** → [ARCH-005](../10-nsn-nsc-critique/architecture-issues.md#arch-005)

## 3. 功能缺口 FUNC

### FUNC-001 · NSC TUN 数据面只换前缀,未建 TUN 设备 ⚠️ 影响安全
- **Severity**: P1
- **Location**: `crates/nsc/src/main.rs:90-95, 199-202`;`crates/nsc/src/vip.rs:18-26`
- **现状**: `DataPlane::Tun` 仅触发 `VipAllocator::new_tun()`(前缀 `100.64.0.0/16` 替代 `127.11.0.0/16`),**无 TUN 设备创建、无 ip route 注入、无 root 检查**。`100.64.x.x` 实际**根本不可达**
- **Why a defect**: CLI 帮助文本承诺 "routes traffic via a TUN interface, requires root",与实现矛盾;用户访问 `100.64.0.x` 失败但 NSC 仍 println "ready" —— **静默欺骗**
- **Fix**: 二选一 —— (A) 删除 `DataPlane::Tun`;(B) 用 `tun-rs` / `gotatun::tun` 真正建设备 + `ip route add` + packet-level routing
- **原文** → [FUNC-001](../10-nsn-nsc-critique/functional-gaps.md#func-001)

### FUNC-002 · `nsc --device-flow` 直接 bail,但 `device_flow` crate 已实现
- **Severity**: P2
- **Location**: `crates/nsc/src/main.rs:171-173` `anyhow::bail!("--device-flow is not yet implemented in nsc")`;底层 `crates/control/src/device_flow.rs` 是完整的,NSN 已在用
- **现状**: NSC 解析了 flag 但在缺 `--auth-key` 时直接报错退出
- **Why a defect**: 纯粹的"接线缺失",与"客户端零运维注册"的产品意图矛盾
- **Fix**: 参照 NSN 调用 `device_flow::DeviceFlowClient::request_user_code → show_to_user → poll_until_authorized → auth_client.register_with_token`
- **原文** → [FUNC-002](../10-nsn-nsc-critique/functional-gaps.md#func-002)

### FUNC-003 · `nsc status` 子命令只 print 占位文本
- **Severity**: P3
- **Location**: `crates/nsc/src/main.rs:137-143` `println!("Sites:"); println!("  (connect to a running 'nsc' daemon to see live status)");`
- **现状**: 显式 `// TODO`,需要 IPC 与 daemon 通信
- **Why a defect**: NSC 是 daemon + CLI 双形态,但 CLI 模式只 echo 占位。对比 NSN 的 `/api/status` 端点,运维体验差
- **Fix**: 在 daemon 内启动 UNIX socket(`{state_dir}/nsc.sock`)或 `127.0.0.1:9091` HTTP,暴露 sites / vips / dns_records / tunnel_state 的 JSON
- **原文** → [FUNC-003](../10-nsn-nsc-critique/functional-gaps.md#func-003)

### FUNC-004 · `_token_rx` 在 NSC 被显式丢弃 → token 长时刷新失效 ⚠️ 影响安全
- **Severity**: P1
- **Location**: `crates/nsc/src/main.rs:195` `_token_rx` 下划线丢弃;`main.rs:227` `ProxyManager::new(..., String::new())` 初始 token 是空字符串
- **现状**: NSD 推送 `token_refresh` 事件不被 NSC 消费,proxy_mgr 的 token 永远是初始空值
- **影响**: NSC 在 NSGW WSS 路径上所有需要 Bearer token 的请求都用空 token 或过期 token。短连接可能蒙混过关,长连接 / token 轮转后即失败
- **Fix**: 把 `_token_rx` 接成 `mut token_rx`,主循环加 `Some(new_token) = token_rx.recv() => proxy_mgr.set_token(new_token).await`;`ProxyManager` 加 `async fn set_token`
- **原文** → [FUNC-004](../10-nsn-nsc-critique/functional-gaps.md#func-004)

### FUNC-012 · NSC 没有出站 ACL,`AclConfig` 仅约束 NSN 侧
- **Severity**: P2(功能缺失而非 bug,但严重影响零信任客户端定位)
- **Location**: `crates/nsc/src/main.rs:195` 的 `_acl_rx` 丢弃;NSC 内整体无 `acl::AclEngine` 实例
- **现状**: NSC 收到 `_acl_rx` 但丢弃,本身不评估 ACL;所有访问控制依赖 NSN 端在收到 WSS Open / 路由 packet 时检查
- **影响**: NSC 无法在出站时拒绝违反策略的请求,浪费 NSGW 流量 / NSN log 噪声 / 用户无即时反馈;端到端审计无"客户端侧的 deny 日志"
- **Fix**: 在 NSC `proxy_mgr` 内嵌 `Option<AclEngine>`,由 `_acl_rx` 更新;HTTP CONNECT / VIP listener 入口调用 `acl.is_allowed(target)`
- **原文** → [FUNC-012](../10-nsn-nsc-critique/functional-gaps.md#func-012)

## 4. 可观测性 OBS

### OBS-010 · NSC 完全没有指标端点
- **Severity**: P2
- **Location**: `crates/nsc/src/main.rs` 不包含 `monitor.rs`;`grep -n "init_telemetry" crates/nsc/` 零命中
- **现状**: NSC 不监听 `/api/metrics` / `/api/status` / `/api/healthz`,也没有 OTel pipeline 初始化
- **影响**: 用户端故障是支持工单第一来源,无指标 → 远程 triage 无法进行;无法回答"DNS 是否被 NSC 接管 / VIP 端口绑定成功率 / NSGW RTT"
- **Fix**: 在 NSC 引入 minimal `/metrics` 端点(监听 `127.0.0.1` 即可),暴露 `dns_queries_total` / `vip_ports_active` / `nsgw_rtt` / `proxy_connections` / `ws_reconnects_total`
- **原文** → [OBS-010](../10-nsn-nsc-critique/observability-gaps.md#obs-010)

## 5. 安全问题 SEC

### SEC-006 · NSC 完全没有出站 ACL — 用户客户端可以访问任何 service
- **Severity**: P1
- **Location**: `crates/nsc/src/main.rs:195`(`_acl_rx` 显式丢弃);`crates/nsc/src/proxy.rs`、`router.rs`、`dns.rs`(全无 `acl::` 引用)
- **现状**: NSC 从 SSE 接收 acl 配置流,直接丢弃;本地代理路由到 NSGW 时不做 ACL 校验,完全依赖 NSGW 端 WSS Open frame 兜底
- **影响**: 多层防御原则被破坏;下游 NSGW 若被绕过/降级,无边界保护;用户无法"提前看到"某 service 被禁(必须发起连接才被 reset);审计日志无"尝试访问被禁服务"
- **Fix**: 在 NSC 的 SSE 消费路径接管 `_acl_rx`,复用 `acl::AclEngine`(与 NSN 同源);在 `router.resolve_*` 路径加 ACL 检查;与 NSN 一致 fail-CLOSED 启动窗口
- **原文** → [SEC-006](../10-nsn-nsc-critique/security-concerns.md#sec-006)

### SEC-010 · Token 刷新通道 `_token_rx` 在 NSC 被丢弃
- **Severity**: P1(安全可用性混合)
- **Location**: `crates/nsc/src/main.rs:195`
- **现状**: NSC 接收 SSE 推送的新 token 但不应用;旧 token 过期后所有控制流 401
- **影响**: 一旦 NSD 因安全原因 revoke 当前 token,NSC 无法收新 token,继续用旧 token 重试;服务端密钥轮换对 NSC 无效;失败时 NSC 不主动退出/告警 → 长时间"半瘫痪"
- **Fix**: 在 SSE 消费循环接管 `token_rx`,调用 `transport.set_token(new_token)`,与 NSN 在 `crates/control/src/lib.rs:307-370` 一致
- **原文** → [SEC-010](../10-nsn-nsc-critique/security-concerns.md#sec-010)

### SEC-011 · OAuth2 device-flow access_token 仅内存 (NSC/NSN 共有)
- **Severity**: P3
- **Location**: `crates/control/src/device_flow.rs`;access_token 不落盘
- **现状**: 进程重启即需重新走 device flow
- **影响**: 对 NSC 尤其尴尬 —— 用户侧进程经常重启(登出 / 重启笔记本);每次都要浏览器粘 user_code
- **Fix**: 持久化到 `{state_dir}/access_token`(需要与 machinekey 一起 AEAD 加密,跟 SEC-004 同期做)
- **原文** → [SEC-011](../10-nsn-nsc-critique/security-concerns.md#sec-011)

## 6. 共享栈缺陷(NSN 主导修复,但影响 NSC)

NSN 与 NSC 共享 `crates/control / crates/acl / crates/tunnel-* / crates/auth`,以下缺陷由 NSN 侧为主修复,但 NSC 部署形态受其影响:

| ID | 一句话 | 对 NSC 的影响 | 原文 |
| --- | --- | --- | --- |
| SEC-002 | `to_http_base()` 把 `noise://` / `quic://` 改写为明文 `http://` | NSC register/heartbeat 同样走明文 | [SEC-002](../10-nsn-nsc-critique/security-concerns.md#sec-002) |
| SEC-003 | authenticate 签名仅本地时间戳,无 server nonce → 重放窗口 | NSC 注册阶段同受影响 | [SEC-003](../10-nsn-nsc-critique/security-concerns.md#sec-003) |
| SEC-004 | 身份密钥 `machinekey.json` 明文 hex JSON 落盘 | NSC state dir(`/var/lib/nsio-nsc`)同样明文 | [SEC-004](../10-nsn-nsc-critique/security-concerns.md#sec-004) |
| SEC-009 | Bearer token 多处 `format!()` 拼接,可能进 debug 日志 | NSC 的 control plane 代码同栈 | [SEC-009](../10-nsn-nsc-critique/security-concerns.md#sec-009) |
| SEC-012 | QUIC 信任完全基于 SHA-256 fingerprint pinning | 若 NSC 未来启用 QUIC 同样中招 | [SEC-012](../10-nsn-nsc-critique/security-concerns.md#sec-012) |
| FAIL-003 | WSS 单连接 head-of-line blocking | NSC 走 WSS 同受 HOL 影响;多 site 并发打流时明显 | [FAIL-003](../10-nsn-nsc-critique/failure-modes.md#fail-003) |
| FAIL-007 | 控制面 backoff 指数退避时 token 可能过期,重连 401 再退避 | NSC 长跑后重连更容易触发 | [FAIL-007](../10-nsn-nsc-critique/failure-modes.md#fail-007) |
| PERF-002 | WSS data 帧每次 `Vec::to_vec()` 拷贝 | NSC 打流同样受益于零拷贝改造 | [PERF-002](../10-nsn-nsc-critique/performance-concerns.md#perf-002) |
| PERF-003 | tunnel-ws 单 TCP socket 是吞吐天花板 | 同上 | [PERF-003](../10-nsn-nsc-critique/performance-concerns.md#perf-003) |

## 7. NSC 缺陷总览(按主题映射)

70+ 缺陷在 [improvements.md](../10-nsn-nsc-critique/improvements.md) 收敛到 7 个主题,NSC 相关的落在:

| 主题 | 关联 NSC 改造 | 关闭 NSC 缺陷 |
| --- | --- | --- |
| Theme A · ACL/Policy 重整 | A.6 NSC 接管 `_acl_rx`,复用 `acl::AclEngine`,路由走 ACL | SEC-006 · FUNC-012 |
| Theme C · 可观测性栈 | C.8 NSC 增加 minimal `/metrics`(127.0.0.1) | OBS-010 |
| Theme E · 半成品收尾 | E.1 `--data-plane tun` 二选一;E.2 `--device-flow` + `status`;E.3 接管 `_token_rx/_wg_rx/_proxy_rx` | FUNC-001 / FUNC-002 / FUNC-003 / FUNC-004 / SEC-010 / ARCH-005 |

## 8. 半成品 / dead_code 一览

来自 [10 · current-state §8](../10-nsn-nsc-critique/current-state.md#8-半成品--dead_code-一览) 与 [06 · design §实现状态](../06-nsc-client/design.md#实现状态):

| 位置 | 现象 |
| --- | --- |
| `nsc/main.rs:138` | `Status` 子命令明文 TODO |
| `nsc/main.rs:172` | `--device-flow` 直接 `bail!("not yet implemented")` |
| `nsc/main.rs:195` | `_wg_rx, _proxy_rx, _acl_rx, _token_rx` 用下划线显式丢弃 |
| `nsc/main.rs:227` | `ProxyManager::new(router, String::new())` 初始 token 硬编码空字符串 |
| `nsc/vip.rs:19-24` | TUN 模式只改 VIP 前缀,无 `tun0` 设备、无 `ip route` |

## 9. 跨缺陷主题:诚实的接口表面

来自 [10 · functional-gaps §跨缺陷主题](../10-nsn-nsc-critique/functional-gaps.md#跨缺陷主题诚实的接口表面):

NSC 的 CLI 表面承诺了 3 种 data plane、2 种注册方式、1 个 status 子命令。其中 **`tun` 模式是假的**、**`--device-flow` 是假的**、**`status` 是假的**。累积的"表面承诺 ≠ 实际能力"让接手者难以判断"这能力该不该用"。

改进方向:在 CLI 解析阶段就**早失败 + 明确说明**,比"启动了再发现没用"更可信。具体落地见 [improvements.md §4 NSC 诚实的接口表面](../10-nsn-nsc-critique/improvements.md)。

---

更详细的 9-字段缺陷描述(Severity / Location / Current / Why-defect / Impact / Fix / Cost-Benefit / Migration-risk)见原章节:

- [10 · architecture-issues.md](../10-nsn-nsc-critique/architecture-issues.md) · 10 条 ARCH(本页收录 1 条 NSC-only)
- [10 · functional-gaps.md](../10-nsn-nsc-critique/functional-gaps.md) · 12 条 FUNC(本页收录 5 条 NSC 相关)
- [10 · failure-modes.md](../10-nsn-nsc-critique/failure-modes.md) · 11 条 FAIL(本页收录 2 条共享栈)
- [10 · performance-concerns.md](../10-nsn-nsc-critique/performance-concerns.md) · 10 条 PERF(本页收录 2 条共享栈)
- [10 · observability-gaps.md](../10-nsn-nsc-critique/observability-gaps.md) · 12 条 OBS(本页收录 1 条 NSC-only)
- [10 · security-concerns.md](../10-nsn-nsc-critique/security-concerns.md) · 15 条 SEC(本页收录 2 条 NSC-only + 5 条共享栈)
- [10 · improvements.md](../10-nsn-nsc-critique/improvements.md) · 7 主题 fix proposal
- [10 · methodology.md](../10-nsn-nsc-critique/methodology.md) · 评分口径与缺陷格式
