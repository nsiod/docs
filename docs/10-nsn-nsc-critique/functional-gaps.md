# 功能层缺陷 · FUNC-*

> 这里记录的是**未完成实现**：把缺失的代码写完就消失，无需重新设计接口。判别规则见 [methodology.md §5](./methodology.md#5-结构性缺陷-vs-未完成实现-判别)。带「⚠ 影响安全」标记的缺陷可能跨入 [security-concerns.md](./security-concerns.md)。

[FUNC-* 缺陷概览 · NSN/NSC 模块实现状态](./diagrams/func-gaps-overview.d2)

---

## FUNC-001 · NSC TUN 数据面只换前缀，未建 TUN 设备 ⚠ 影响安全
- **Severity**: P1（接口承诺与实现不符；用户启用 `--data-plane tun` 期望 root + 内核路由，实际什么都没多做）
- **Location**: `crates/nsc/src/main.rs:90-95, 199-202`；`crates/nsc/src/vip.rs:18-26`
- **Current**: `DataPlane::Tun` 仅触发 `VipAllocator::new_tun()`（前缀 `100.64.0.0/16` 替代 `127.11.0.0/16`），**无 TUN 设备创建、无 ip route 注入、无 root 检查**。`100.64.x.x` 是普通子网地址，没有任何路由把它送到 NSC 的代理监听器上 — 实际上**根本不可达**。
- **Why a defect**: 三件事同时发生：
  1. CLI 帮助文本（`main.rs:39`）声称 "tun — routes traffic via a TUN interface, requires root"，与实现矛盾。
  2. 用户启用 TUN 模式后，浏览器/curl 访问 `100.64.0.x` 会失败但 NSC 仍然 println 出 "ready" — **静默欺骗**。
  3. 一些用户会以为 `100.64/16` 在远端站点是可路由的（因为不是回环），可能把内部流量发到错误的地方。
- **Impact**: 误用风险高；TUN 模式是 sales/docs 中的卖点，实际不可用。
- **Fix**: 二选一：
  - **A 删除**：把 `DataPlane::Tun` 从 enum 移除，文档/帮助也去掉；保留 `Userspace`+`Wss`。
  - **B 实现**：使用 `tun-rs` 或 `gotatun::tun::TunDevice` 创建真实接口，在启动时检测 root 权限（`is_privileged()` 已经在 `nsn/src/main.rs:1521` 实现，移到 `common`）；注入 `ip route add 100.64.0.0/16 dev nsc0`；引入 packet-level routing 把入向 `100.64.x.x` 五元组转给 `proxy::ProxyManager`。
- **Cost**: A 方案 ~30 行；B 方案 ~600~800 行 + 一套独立 e2e 测试。
- **Benefit**: 接口与实现一致；用户的部署期望不被静默打破。
- **Risk**: B 方案引入特权代码路径，需要 capability dropping / setuid 安全审计。

---

## FUNC-002 · `nsc --device-flow` 直接 bail，但 `device_flow` crate 已实现完整 OAuth2 device flow
- **Severity**: P2
- **Location**: `crates/nsc/src/main.rs:171-173`：`anyhow::bail!("--device-flow is not yet implemented in nsc");`；`crates/control/src/device_flow.rs`（137 行，`request_user_code` / `poll_for_token`）；`crates/control/src/auth.rs:194` `register_with_token` 已在用
- **Current**: NSC 端解析了 `--device-flow` flag（`main.rs:54-55`），但当 user 没提供 `--auth-key` 时直接报错"未实现"。底层 `device_flow.rs` 是完整的，NSN 也在用 `register_with_token`。
- **Why a defect**: 这是纯粹的"接线缺失"。NSC 完全可以参照 NSN 用同一套 `device_flow::DeviceFlowClient::run(...)` → `auth_client.register_with_token(token)`。
- **Impact**: NSC 用户在交互式安装场景必须先去搞 authkey，违背"客户端零运维注册"的产品意图。
- **Fix**: 在 `main.rs:171` 处替换为：
  ```text
  let token = device_flow::DeviceFlowClient::new(server_url)
      .request_user_code()?
      .show_to_user()?
      .poll_until_authorized()?;
  auth_client.register_with_token(&token).await?;
  ```
  接口名称按 device_flow.rs 实际签名调整；UX 输出沿用 NSN 的格式。
- **Cost**: 30~50 行。
- **Benefit**: NSC 安装可走"打开浏览器→粘 user_code"流程，无 authkey 分发负担。
- **Risk**: 设备 token 的存储路径要与 NSN 一致（`{state_dir}/access_token` 等），避免重复实现存储。

---

## FUNC-003 · `nsc status` 子命令只 print 占位文本
- **Severity**: P3（影响运维但非阻塞；使用者可改用 `journalctl` 或日志文件）
- **Location**: `crates/nsc/src/main.rs:137-143`：`println!("Sites:"); println!("  (connect to a running 'nsc' daemon to see live status)");`
- **Current**: 显式 `// TODO` 标注，"需要 IPC 与运行中的 daemon 通信（UNIX socket / 状态文件）"。
- **Why a defect**: NSC 是 daemon + CLI 双形态二进制，但 CLI 模式只是"echo 一句没用的话"。这与 NSN 的 `/api/status` HTTP 端点形成对比 — NSN 更对运维友好。
- **Impact**: 用户排查 NSC 状态只能 `tail -f` 日志或翻 stdout。
- **Fix**: 在 daemon 内启动 UNIX socket（`{state_dir}/nsc.sock`）暴露 JSON：sites / vips / dns_records / tunnel_state。`nsc status` 走该 socket。NSN 有个 `127.0.0.1:9090` 模式可以借鉴（甚至可以让 NSC 也监听 `127.0.0.1:9091` HTTP）。
- **Cost**: 100~200 行（socket server + handler + CLI 客户端）。
- **Benefit**: 与 NSN 运维体验对齐；CI / monitoring 可以无侵入采集 NSC 状态。
- **Risk**: UNIX socket 文件权限需谨慎（0600 + 同 user）；HTTP-on-localhost 比 socket 更便携但需挑非冲突端口。

---

## FUNC-004 · `_token_rx` 在 NSC 被显式丢弃 → token 长时刷新失效 ⚠ 影响安全
- **Severity**: P1
- **Location**: `crates/nsc/src/main.rs:195`：`let (control, _wg_rx, _proxy_rx, _acl_rx, mut gw_rx, mut routing_rx, mut dns_rx, _token_rx) = ControlPlane::new(...)`
- **Current**: NSC 收下 `ControlPlane` 的 8 个 receiver，把 `_token_rx` 用 `_` 丢弃。这意味着 NSD 推送的 `token_refresh` 事件不被 NSC 内部消费，proxy_mgr 持有的 token 永远是初始值（`String::new()` 见 `main.rs:227`）。
- **Why a defect**: 1) `proxy_mgr = ProxyManager::new(..., String::new())`：从启动起 token 就是空字符串；2) 控制面 `dispatch_message` 收到 `token_refresh` 后会通过 `_token_rx` 推出来，但 NSC 永远不接 — 等于"刷新无人接听"。
- **Impact**: NSC 在 NSGW WSS 路径上所有需要 Bearer token 的请求都用空 token 或过期 token。短连接可能因短期 token 不过期而蒙混过关，长连接 / token 轮转后即失败。
- **Fix**: 把 `_token_rx` 接成命名 `mut token_rx` 并在主循环加一个 select 分支：
  ```text
  Some(new_token) = token_rx.recv() => {
      proxy_mgr.set_token(new_token).await;
  }
  ```
  `ProxyManager` 加一个 `async fn set_token(&self, t: String)`；并把 token 同步给 `NscRouter` 用于将来的请求 header 注入（如有）。
- **Cost**: 40 行 + 1 个新方法签名。
- **Benefit**: NSC 长时运行 token 轮转生效；消除"token 永远空"的隐藏 bug。
- **Risk**: 无（增量改动）。

---

## FUNC-005 · `ConntrackTable` 仅有 `insert`，无 GC、无 TTL、无容量上限
- **Severity**: P0（确定性内存泄露，长跑必然 OOM；DoS 可被故意触发）
- **Location**: `crates/nat/src/packet_nat.rs:74-84` 定义；`:310` 唯一插入点；全文件 grep "remove|cleanup|prune|expire|gc|sweep" 命中 0
- **Current**: `ConntrackTable(Arc<DashMap<ConntrackKey, ConntrackVal>>)`。每个发往本地服务的 forward 报文在 `:310` 插入一条 reverse-key 条目；reverse path 在 `:376-389` 只读不删；表无任何驱逐机制。
- **Why a defect**: 这是 packet NAT 的经典缺陷。每个 conntrack entry ~64 字节（key 18 + val 12 + DashMap 开销）。一台 NSN 一秒 10k pps 的 unique 五元组（小流场景，UDP DNS 之类完全可达）= 一天 8.6 亿条 = 55 GB。即使流量保守，长跑数月也必然 OOM。同时**反向 NAT 静默丢弃没有 conntrack 的报文**（`:376` 的 `?` 操作符），意味着如果 conntrack 因任何原因丢条目（未来加 LRU 也好），反向报文直接消失，TCP 重传、UDP 应用层都无法获知。
- **Impact**: 长时运行 OOM；DoS 攻击者可发送随机源端口报文耗尽内存；当前架构下没有任何监控指标能预警（`nsn_nat_active_entries` 是另一个 NAT 表的统计，conntrack 表本身没有 metric）。
- **Fix**: 设计四件事一起做：
  1. **TTL**：每条 entry 加 `created_at: Instant` 与 `last_seen: Instant`；reverse path 命中时 update last_seen。
  2. **GC**：每 30s 跑一次后台扫描，删除 `now - last_seen > 120s`（TCP）/`> 30s`（UDP）的条目。或者用 `moka::sync::Cache` 替代 DashMap，自带 TTL + LRU。
  3. **容量上限**：可配置 `nat.conntrack_max_entries`，达到后 LRU 驱逐 + log warn + metric `nsn_conntrack_evicted_total`。
  4. **Metrics**：暴露 `nsn_conntrack_entries_active`、`nsn_conntrack_inserts_total`、`nsn_conntrack_evicted_total`、`nsn_conntrack_reverse_miss_total`（最后这条恰好是 [OBS-003](./observability-gaps.md) 提到的"反向 NAT 查不到静默丢包"的可观测化）。
- **Cost**: ~250 行（含测试）；如选用 `moka` 增加一个外部依赖。
- **Benefit**: 消除已确定的 OOM 路径；为容量规划与 DoS 检测提供数据。
- **Risk**: TTL 阈值需要场景化调参（TCP keepalive、UDP DNS 短流）；首版上线建议只开 TTL、暂不开 LRU，便于观察驱逐率。

---

## FUNC-006 · 全栈仅支持 IPv4
- **Severity**: P1（视为"未实现 IPv6"而非 bug）
- **Location**: 全栈 `Ipv4Addr` 硬编码：`crates/nat/src/router.rs`、`crates/nat/src/packet_nat.rs`、`crates/tunnel-wg/src/acl_ip_adapter.rs`；`tunnel-ws` 协议层支持 `CMD_OPEN_V6`（`tunnel-ws/src/lib.rs:218-241`）但**无上游产生 OPEN_V6 帧**
- **Current**: `parse_five_tuple` 只解 IPv4；conntrack key 是 `Ipv4Addr`；ACL `AclEngine` 接受 `IpAddr` 但实际链路只来 v4；NSC VIP 是 `127.11.x.x` v4。WSS 帧支持 v6 是孤岛能力。
- **Why a defect**: 当前互联网逐步 IPv6-only（特别是移动运营商、企业园区）；没有 IPv6 等于没法部署到这些环境。即便不真正路由 IPv6，至少要支持"跑在 v6-only 链路上"。
- **Impact**: 部署受限；未来扩到企业级或运营商网络需要大改。
- **Fix**: 分层处理：
  - 控制流（HTTP/TLS/QUIC）：libsserver 已经支持 v6 socket，直接打开 dual-stack listener（`0.0.0.0` → `[::]`）。
  - 数据流（WG）：gotatun 本身支持 v6，需要 `WgConfig.peer_endpoint` schema 接受 v6 字面量。
  - NAT/conntrack：把 `ConntrackKey.src_ip / dst_ip` 改为 `IpAddr`，Hash 实现已经支持。
  - NSC VIP：保留 v4 默认，加可选 `--vip-prefix6 fd00:nsc::/96` 让 v6-only 系统可用。
- **Cost**: 大（~1500 行 + 全套测试）；建议拆三个 milestone（控制 / 数据 / NSC）。
- **Benefit**: 部署面扩大；规避未来必然的 v4 退出。
- **Risk**: dual-stack 环境的 happy-eyeballs 需要明确策略；任何"硬编码 0.0.0.0"都要审。

---

## FUNC-007 · NSGW 健康检查未真正定时执行（指 connector 端）
- **Severity**: P1（cross-link 自 [ARCH-004](./architecture-issues.md#arch-004--multigatewaymanager-健康检查周期被-allowdead_code-遮蔽)）
- **Location**: `crates/connector/src/multi.rs:156-157`
- **Current**: `health_interval` 字段标 `#[allow(dead_code)]`，无对应任务驱动。健康判定靠"实际请求失败"被动触发。
- **Why a defect**: 详见 [ARCH-004](./architecture-issues.md#arch-004--multigatewaymanager-健康检查周期被-allowdead_code-遮蔽)。归类为 functional 是因为字段已存在，只是 task 未挂上 — 写完不需要重新设计接口。
- **Fix**: 见 ARCH-004 的 Fix 段。

---

## FUNC-008 · `tunnel-wg::AclFilteredSend::is_packet_allowed` 名实不符
- **Severity**: P3
- **Location**: `crates/tunnel-wg/src/acl_ip_adapter.rs:67-73`
- **Current**: 函数名暗示按 ACL 引擎判定，实际只判"是否 IPv4 TCP/UDP"，未消费 `AclEngine`。
- **Why a defect**: 函数名/模块名误导。
- **Impact**: 未来 reader 看到这个名字会以为 ACL 已生效在 IP 层。
- **Fix**: 配合 [ARCH-007](./architecture-issues.md#arch-007--tunnel-wgaclfilteredsend-形式上是抽象层实质是死代码) 的"删除 or 实现"决策。如果留，重命名为 `Ipv4FlowFilter` + `is_parseable_flow`。
- **Cost**: 30 行（含 doc 修正）。
- **Benefit**: 消除误导。
- **Risk**: 无。

---

## FUNC-009 · 服务上报 `services_ack` 不会被消费回 services.toml 校正
- **Severity**: P3
- **Location**: `crates/control/src/sse.rs:104` `post_services_report`；`crates/control/src/messages.rs` 中 `services_ack` 事件类型；`nsn/src/main.rs` 未对 `services_ack` 做后续动作
- **Current**: NSN 启动时 POST 本地 services 摘要给 NSD，NSD 通过 SSE 回 `services_ack`（含验证结果，比如 chain_id、是否被 NSD 接受）。dispatch_message 处理这个事件但没有 callback。
- **Why a defect**: 配置漂移检测断了一半 — NSD 知道 services 是否合法，NSN 也收到了 ack，但没把 ack 反映到 `/api/services` 或 `/api/status`。
- **Impact**: 运维不能从 NSN 端看到"我的 services 配置在 NSD 看来是否合法"；只能从 NSD 端查。
- **Fix**: dispatch_message 收到 `services_ack` 时写入 `AppState::services_ack: Option<ServicesAck>`，monitor.rs 在 `/api/services` 响应里加 `last_ack: { chain_id, accepted, errors }`。
- **Cost**: 50 行。
- **Benefit**: 端到端配置链路在 NSN 侧可观测。
- **Risk**: 无。

---

## FUNC-010 · NSN 心跳 `local_ips` 仅在启动期采集，运行中不刷新
- **Severity**: P2
- **Location**: `crates/control/src/auth.rs:46-100`（HeartbeatPayload + HeartbeatClient）；调用方 `crates/nsn/src/main.rs` 的心跳启动段
- **Current**: HeartbeatPayload 包含 `local_ips: Vec<String>`，但 `local_ips` 通常在 spawn 心跳任务时一次性采集（取决于 spawner 实现 — 当前 NSN 只把 `Vec<String>` 传给 `HeartbeatClient::new` 之后周期发同一份）。机器迁移网卡 / DHCP 续约后 NSD 看到的 IP 是过时的。
- **Why a defect**: 心跳的语义本应是"实时机器状态"，包括但不止 uptime。IP 静态化让 NSD 端的 dashboard / observability 失去时效性。
- **Impact**: 多 NSGW 选路如果借助 `local_ips`（用于"客户端位置感知"），数据陈旧；当前是否真这么用要看 NSD 实现，但接口承诺即应兑现。
- **Fix**: HeartbeatClient 内部每次 send 前调用 `network_interfaces::list()` 重采。或者在 NSN 监听 `netlink` 变更事件并把当前 list 推到 heartbeat 任务。
- **Cost**: 60 行（重采）/ 200 行（netlink 监听）。
- **Benefit**: heartbeat 真正反映当前网络配置。
- **Risk**: 频繁重采可能产生 syscall 开销 — 但每 30s 可忽略。

---

## FUNC-011 · `proxy::handle_tcp_connection` 在生产路径上未被调用
- **Severity**: P3（cross-link 自 [ARCH-003](./architecture-issues.md#arch-003--nsnsrcmainrs-里的-relay__connection-与-proxyhandle_tcp_connection-形成两套-tcp-relay)）
- **Location**: `crates/proxy/src/tcp.rs:12-90`
- **Current**: 函数实现完整（含 `ProxyMetrics::active_connections / bytes_*` 更新），但生产路径只调 `nsn/src/main.rs` 里的 4 个 `relay_*_connection`，后者无 metrics。
- **Why a defect**: dead-on-prod-alive-on-test。删除会破坏 proxy crate 的测试；保留则与 main.rs 那套构成双轨。
- **Fix**: 见 ARCH-003。
- **Cost / Benefit / Risk**: 见 ARCH-003。

---

## FUNC-012 · NSC 没有出站 ACL，`AclConfig` 仅约束 NSN 侧
- **Severity**: P2（功能缺失而非 bug，但严重影响零信任客户端定位）
- **Location**: `crates/nsc/src/main.rs:195` 的 `_acl_rx` 丢弃；NSC 内整体无 `acl::AclEngine` 实例
- **Current**: NSC 收到 `_acl_rx` 但丢弃，本身不评估 ACL。所有访问控制依赖 NSN 端在收到 WSS Open / 路由 packet 时检查。
- **Why a defect**: 1) 节省了"客户端被 root 攻破后绕 ACL"的难度 — 客户端只要发出请求，NSN 端拒绝；这是"合理的最小信任假设"；2) 但反过来，**NSC 无法在出站时拒绝违反策略的请求**，浪费 NSGW 流量、给 NSN log 噪声、让用户误以为可访问；3) 也无法在客户端侧给用户即时提示"该资源被 ACL 拒"。
- **Impact**: 是设计取舍而非 bug，但 [ARCH-005](./architecture-issues.md#arch-005--nsc-主循环只-select-3-路-sse-事件忽略-4-路接收器) 已经留出消费 `_acl_rx` 的接口入口，补上后可获得"客户端预检 + 服务端权威检查"的双层模型。
- **Fix**: 在 NSC `proxy_mgr` 内嵌一个 `Option<AclEngine>`，由消费 `_acl_rx` 任务更新；HTTP CONNECT / SOCKS 入口调用 `acl.is_allowed(target)`，不允许则返回 403/Reject。
- **Cost**: ~150 行 + 一组 e2e 测试。
- **Benefit**: 双层 ACL（客户端预检 + 服务端权威），减少无效流量。
- **Risk**: 客户端 ACL 可能与 NSN 不同步 — 必须接受"客户端预检放行但服务端拒绝"为正常情况，不视为不一致。

---

## 跨缺陷主题：诚实的接口表面

NSC 的 CLI 表面承诺了 3 种 data plane、2 种注册方式、1 个 status 子命令。其中 **`tun` 模式是假的**、**`--device-flow` 是假的**、**`status` 是假的**。这种"表面承诺 ≠ 实际能力"的累积让接手者难以判断"这能力是不是该用"。

改进方向：在 CLI 解析阶段就 *早失败 + 明确说明*，比"启动了再发现没用"更可信。具体落地见 [improvements.md §4](./improvements.md#4-nsc-诚实的接口表面)。

## 快速跳转

- 安全相关（FUNC-001 / FUNC-004 / FUNC-005）→ [security-concerns.md](./security-concerns.md)
- 失败模式（FUNC-005 / FUNC-007）→ [failure-modes.md](./failure-modes.md)
- 改进矩阵 → [improvements.md](./improvements.md)
