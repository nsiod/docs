# netstack — 用户态 TCP/IP 协议栈

> 源码：`crates/netstack/src/` — `lib.rs` / `device.rs` / `stack.rs`
> 外部依赖：[`smoltcp`](https://github.com/smoltcp-rs/smoltcp) 0.12、`tokio::sync::mpsc`
> 内部依赖：仅 `common`（见架构文档的 crate 依赖图）

`netstack` 负责把 `gotatun` 解密出的裸 IP 报文转换成用户态可调用的 **TCP 连接** 与 **UDP 数据报**，并在 UserSpace 模式下承担 NSN 的 TCP 三次握手、重传、拥塞控制等任务。TUN 模式不经过 netstack，但 `nat` 在处理远端服务时仍会把报文投递回 `netstack` —— 所以 netstack 同时是 UserSpace 模式的主路径，也是 TUN 模式的备用路径。

## 模块职责

- 把字节序列的 IPv4 报文塞进 `smoltcp`（`VirtualDevice::inject`，`crates/netstack/src/device.rs:49`）。
- 维护"每个目标 TCP 端口一个监听 socket"的约定（`ensure_tcp_listener`，`crates/netstack/src/stack.rs:471`）。
- UDP 不经过 smoltcp：直接解析五元组后发 `NewUdpDatagram` 事件（`udp_info`，`crates/netstack/src/stack.rs:342`）。
- 把协议栈产出的出向报文回推到 `gotatun` 的加密通道（`tx_out`，`crates/netstack/src/stack.rs:252`）。
- 把新建连接 / 新数据报通过 `mpsc::Sender<NewTcpConnection>` / `mpsc::Sender<NewUdpDatagram>` 交给 `proxy` 层的 `relay_*` 任务。

## 对外 API 概览

```rust
// crates/netstack/src/lib.rs:16-19
pub mod device;
pub mod stack;
pub use stack::{NetStack, NewTcpConnection, NewUdpDatagram};
```

| 类型 | 定义位置 | 用途 |
|------|----------|------|
| `NetStack` | `crates/netstack/src/stack.rs:38` | 持有 `VirtualDevice` 与虚拟 IP；`NetStack::poll` 是整个协议栈的主循环。 |
| `VirtualDevice` | `crates/netstack/src/device.rs:34` | 实现 `smoltcp::phy::Device`，用两条 `VecDeque<Vec<u8>>` 做 RX/TX 队列。 |
| `NewTcpConnection` | `crates/netstack/src/stack.rs:13` | 每个进入 `Established` 状态的连接派发给 proxy 层，附带读 / 写两根 `mpsc` 通道。 |
| `NewUdpDatagram` | `crates/netstack/src/stack.rs:25` | 已拆包的 UDP 载荷 + `reply_tx`；回包会被 `NetStack::poll` 重新封装成 IPv4/UDP。 |
| `Error` | `crates/netstack/src/lib.rs:23` | `thiserror` 派生，仅两种：`Stack(String)` 与 I/O 错误。 |

## VirtualDevice：smoltcp ↔ mpsc 的桥接

`smoltcp` 要求通过一个实现 `Device` trait 的对象读取入向报文并发送出向报文。`VirtualDevice` 用两条 `VecDeque` 实现了最小完整的桥接：

```rust
// crates/netstack/src/device.rs:34-37
pub struct VirtualDevice {
    pub rx_queue: VecDeque<Vec<u8>>,
    pub tx_queue: VecDeque<Vec<u8>>,
}
```

- **入向注入**：外部调用 `device.inject(pkt)` 把 `gotatun` 解密好的 IP 包追加到 `rx_queue`；smoltcp 在 `receive()` 中通过 `VirtualRxToken` 把第一包 pop 给协议栈（`crates/netstack/src/device.rs:75-79`）。
- **出向采集**：协议栈调用 `transmit()` 拿到 `VirtualTxToken`，`token.consume` 会把 smoltcp 写好的 IP 包挂到 `tx_queue`（`crates/netstack/src/device.rs:19-31`）。稍后 `NetStack::poll` 调用 `device.drain_tx().collect()` 把 `tx_queue` 抽干，再经 `tx_out` 发给 gotatun 做加密。
- **能力宣告**：`capabilities()` 固定 `Medium::Ip`、`MTU=1500`（`crates/netstack/src/device.rs:85-90`）。MTU 选 1500 是经典以太网值，既大于 WG overhead 保留后的典型 MTU（1420），也足够 smoltcp 做分片决策。

`VirtualRxToken` 持有 `Vec<u8>` 的拷贝，`VirtualTxToken` 持有 `&mut VecDeque<Vec<u8>>` 引用，二者都实现了 smoltcp 的零成本 token 模式——token 生命周期受限于单次 `poll` 调用，防止跨 poll 持有借用。

## NetStack::poll — 主循环

```rust
// crates/netstack/src/stack.rs:66-72
pub async fn poll(
    mut self,
    mut inject_rx: mpsc::Receiver<Vec<u8>>,
    tx_out: mpsc::Sender<Vec<u8>>,
    new_conn_tx: mpsc::Sender<NewTcpConnection>,
    new_dgram_tx: mpsc::Sender<NewUdpDatagram>,
) -> Result<(), Error>
```

调用契约见源码注释（`crates/netstack/src/stack.rs:58-65`）：

- `inject_rx` — 来自 gotatun 的解密报文；senders 全部 drop 时循环退出。
- `tx_out` — 协议栈的出向报文（含 UDP 回包重封），送回 gotatun。
- `new_conn_tx` / `new_dgram_tx` — 向 proxy 层分发事件。

NSN 主进程的装配见 `crates/nsn/src/main.rs:1005-1018`：

```rust
let stack = NetStack::new(wg_config.ip_address);
let (inject_tx, inject_rx) = mpsc::channel::<Vec<u8>>(256);
let (tx_pkt_tx, mut tx_pkt_rx) = mpsc::channel::<Vec<u8>>(256);
let (new_conn_tx, mut new_conn_rx) = mpsc::channel::<NewTcpConnection>(64);
let (new_dgram_tx, mut new_dgram_rx) = mpsc::channel::<NewUdpDatagram>(64);

tokio::spawn(async move {
    if let Err(e) = stack
        .poll(inject_rx, tx_pkt_tx, new_conn_tx, new_dgram_tx)
        .await
    { tracing::error!("NetStack error: {e}"); }
});
```

`poll` 的每一轮迭代做六件事，顺序不可交换：

1. **排干 `inject_rx`**（`crates/netstack/src/stack.rs:102-136`）：
   - `try_recv` 拉空通道；对每个包先判是否 UDP（`udp_info`），是就直接派 `NewUdpDatagram`；否则若是 TCP，先 `ensure_tcp_listener(dst_port)` 然后塞进 `VirtualDevice`。
   - 发送侧若满 / 关则 `tracing::warn!` 丢包，**绝不阻塞主循环**。
2. **驱动 smoltcp**（`iface.poll`，`crates/netstack/src/stack.rs:140`）：smoltcp 在这里做 TCP 状态机推进、ACK、重传等。
3. **两阶段收割新连接**（`crates/netstack/src/stack.rs:143-187`）：
   - Phase A：遍历 `listeners`，找出状态已变成 `Established` 的 socket handle（只读，仍持有对 `listeners` 的不可变借用）。
   - Phase B：对每个新连接建两对 mpsc（`to_relay` / `from_relay`），发 `NewTcpConnection`，然后用 `ensure_tcp_listener` 为同一端口建回一个新的监听 socket。
   - 两阶段拆分是为了在 Phase B 里对 `listeners` 调用 `remove` / `ensure_tcp_listener` 可变操作。
4. **桥接已建立连接的数据**（`crates/netstack/src/stack.rs:189-228`）：
   - smoltcp → relay：`socket.recv` 有数据就 `chans.data_tx_to_relay.send().await`；对端关闭 → `socket.close()`。
   - relay → smoltcp：`chans.data_rx_from_relay.try_recv` + `socket.send_slice`。
   - 状态为 `Closed` / `TimeWait` 的 socket 从 `conn_chans` / `SocketSet` 一并摘除。
5. **UDP 回包重封**（`crates/netstack/src/stack.rs:230-250`）：
   - 每个活跃 UDP 会话有一条 `reply_rx`；`poll` 轮询 drain，用 `build_udp_reply` 手工组 IPv4/UDP 报头并算校验和。
   - `reply_tx` 被 relay 侧 drop 时 `reply_rx.try_recv` 返回 `Disconnected`，`retain_mut` 移除会话以回收 `udp_sessions` 空间。
6. **出向报文落地 + 等下一轮**（`crates/netstack/src/stack.rs:252-301`）：
   - `self.device.drain_tx()` 抽空 TX 队列，逐包 `tx_out.send`；`tx_out` 关 → 整个循环退出。
   - 用 `iface.poll_delay` 决定睡多久（封顶 50ms）；然后 `tokio::select!` 在 `inject_rx.recv()` / `tokio::time::sleep` 之间取短者，兼顾延迟与 CPU。

### 为什么 UDP 不走 smoltcp

`smoltcp` 0.12 没有一个便利的"监听任意端口"API——必须提前 `bind` 一个 `UdpSocket`。NSN 的 UDP 映射要覆盖 `services.toml` 里声明的所有 UDP 端口，而且要能在运行时热更新，让协议栈按端口动态挂 socket 就会跟主循环耦合。所以 `netstack` 干脆用 20 行的 IPv4/UDP 解析 (`udp_info`) 做"**拦截即派发**"，回包由 `build_udp_reply` 手工拼（含 RFC 768 的 0→`0xFFFF` 空校验和规则，`crates/netstack/src/stack.rs:465`）。代价是——UDP 路径没有 smoltcp 的 socket 缓冲、失序处理，不过 DNS / SSH keepalive 之类场景不需要这些。

### 为什么每端口一个 listener

`ensure_tcp_listener`（`crates/netstack/src/stack.rs:471-486`）在首次收到某 dst_port 的 TCP SYN 时为该端口创建一个 `tcp::Socket` 并 `listen(port)`。连接进入 `Established` 后 listener 被"消耗"，Phase B 立即重建一个新 listener。这种一对一映射让：

- smoltcp 的 `SocketSet` 可以并发持有多个独立的 `tcp::Socket`。
- netstack 不必跟踪「谁在监听哪个端口」的外部状态——有连接进来自动开 listener，端口归零后 listener 被删即可。

每个 `tcp::Socket` 预分配 65 535 字节 RX + 65 535 字节 TX 缓冲（`crates/netstack/src/stack.rs:479-480`），意味着每条活跃连接峰值内存占用约 130 KiB，16 384 条并发连接需要 ≈2 GiB——这是 UserSpace 模式的主要内存成本，也是 TUN 模式避开 smoltcp 能换来的资源节省之一。

## 关键辅助函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `smoltcp_now` | `stack.rs:309` | 封装 `SystemTime::UNIX_EPOCH` 为 smoltcp 的 `Instant`（毫秒精度）。 |
| `tcp_dst_port` | `stack.rs:319` | 从裸 IPv4 报文抽 TCP dst port，校验 version/protocol/IHL。 |
| `udp_info` | `stack.rs:342` | 抽 UDP 五元组 + 载荷，遇到非 IPv4/UDP/截断包返回 `None`。 |
| `build_udp_reply` | `stack.rs:378` | 手工组 IPv4/UDP 报文，含 IP 头 + UDP 伪首部校验和。 |
| `endpoint_to_socket_addr` | `stack.rs:489` | smoltcp `IpEndpoint` → std `SocketAddr` 转换。 |

测试覆盖上，`device.rs` 有 9 个单测、`stack.rs` 有 13 个（含两个 `#[tokio::test]` 跑完整 `poll` 循环），关键的边界如"未注入时 receive 返回 None"、"build_udp_reply round-trips through udp_info"都单独覆盖（分别在 `crates/netstack/src/device.rs:127` 与 `crates/netstack/src/stack.rs:567`）。

## Mermaid：UserSpace 模式数据流

[UserSpace 模式数据流时序](./diagrams/netstack-userspace-sequence.d2)

> 完整 crate 级视图参见 [UserSpace 数据流详图](./diagrams/netstack-flow.d2)。

## 与上下游模块的契约

- **上游（gotatun）**：只消费已解密的完整 IPv4 报文，遇到 IPv6 或非 TCP/UDP 报文直接丢弃（`tcp_dst_port` / `udp_info` 都会返回 `None`，不报错）。
- **下游（proxy / relay）**：`NewTcpConnection::data_rx` 关闭 → smoltcp socket `close()`；`reply_tx` drop → UDP 会话清理。proxy 层不需要了解 smoltcp 的状态机。
- **ServiceRouter**：netstack **不做 ACL / 服务查表**，只在 `local.port` 里把虚拟端口透传给 proxy，由 proxy 用 `router.resolve(src_ip, dst_ip, dst_port, proto)` 决定是否放行，见 [nat.md](./nat.md)。

## 常见坑位

1. **TCP 半关断**：smoltcp 的 `State::Closed` 和 `TimeWait` 都被当作 "可以释放"，`NetStack::poll` 会连 `conn_chans` 条目一起移除；relay 侧若还在写 `data_tx`，`send` 会返回错误——这是上游 relay 需要自行处理优雅关闭的信号。
2. **UDP reply 通道容量**：`build_udp_reply` 的调用方是 poll 循环自己，但 `reply_tx` 容量只有 64 (`crates/netstack/src/stack.rs:109` 与 `crates/netstack/src/stack.rs:276`)；proxy 侧若以极高 QPS 回包，应分片或自行节流。
3. **时间漂移**：`smoltcp_now` 用 `SystemTime::now()`，若系统时钟回拨，smoltcp 的重传定时器会抖动——这是上游 gotatun / netstack 共同继承的限制，不在本模块范围内修复。
4. **TUN 模式依然会用到**：在 `HybridNatSend` 判定为 remote 服务时，原始报文会走 `proxy_tx → inject_rx → netstack`（见 `crates/nat/src/packet_nat.rs:324`），所以即便在 TUN 模式下启动 NetStack 仍是必要的。
