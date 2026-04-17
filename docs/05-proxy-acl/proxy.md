# Proxy — TCP / UDP 中继层

> 源码: `crates/proxy/src/` (`lib.rs` 28 行 — 四个子模块 + 一个 `Error`)

本文档描述 NSN 上"字节进、字节出"的代理中继原语。高层的 L7 路由 (HTTP Host / TLS SNI) 在 [http-host-routing.md](./http-host-routing.md) 与 [sni-routing.md](./sni-routing.md) 中展开。

## 1. 模块位置

```mermaid
graph LR
    IN["解密后流量<br/>smoltcp / WsFrame"] --> SR["ServiceRouter<br/>(nat crate)"]
    SR -- "resolve ACL OK" --> P["proxy::tcp / proxy::udp"]
    P --> SVC["本地或远程<br/>真实服务"]
```

proxy 在依赖图中的位置 (见 `docs/architecture.md:278`):

```
proxy → {common, telemetry}        # 叶子, 无上游业务依赖
```

proxy 不感知 WireGuard / smoltcp, 也不读取 `AclPolicy`; 它只是一层"拿到目标 `SocketAddr` 就去连后端"的中继工具函数。

完整端到端架构参见 [diagrams/proxy-arch.mmd](./diagrams/proxy-arch.mmd)。

## 2. 公共 API

`crates/proxy/src/lib.rs` 导出:

| 符号 | 位置 | 作用 |
|------|------|------|
| `tcp::handle_tcp_connection` | `crates/proxy/src/tcp.rs:12` | 双向 TCP 中继 + 指标 |
| `udp::handle_udp` | `crates/proxy/src/udp.rs:14` | 单流 UDP 回显式中继 |
| `http_peek::parse_http_host` | `crates/proxy/src/http_peek.rs:11` | 从 HTTP/1.x 首包提取 `Host` 头 |
| `sni_peek::parse_tls_sni` | `crates/proxy/src/sni_peek.rs:13` | 从 TLS ClientHello 提取 SNI |
| `Error` | `crates/proxy/src/lib.rs:22` | `Io(std::io::Error)` + `Refused(String)` |

lib.rs 显式声明 `#![forbid(unsafe_code)]` — 整个 crate 不允许 `unsafe`, 所有协议解析都是安全 Rust。

## 3. `relay_connection` 的三路分派

入口在 `crates/nsn/src/main.rs:1118`, 按本地端口选择处理函数:

```rust
// crates/nsn/src/main.rs:1118
async fn relay_connection(conn: NewTcpConnection, router: Arc<ServiceRouter>) {
    match conn.local.port() {
        80  => relay_http_connection(conn, router).await,   // 按 Host 路由
        443 => relay_https_connection(conn, router).await,  // 按 SNI 路由
        _   => relay_port_connection(conn, router).await,   // 按端口路由
    }
}
```

三个分支共同点:

1. 调用 `ServiceRouter::resolve*`, 内部完成 **服务查找 → ACL 校验 → DNS 解析**;
2. 使用 `tokio::net::TcpStream::connect(target)` 直接连后端 (`crates/nsn/src/main.rs:1149`, `:1219`, `:1291`);
3. 启动两个 `tokio::spawn`, 一边 `data_rx → svc_tx`, 一边 `svc_rx → data_tx`, 靠 `tokio::join!` 等待任一方向结束。

差异在于 L7 路径会先 `data_rx.recv().await` 拿到首个 chunk 并做协议 peek, 然后把该 chunk **原样** `write_all` 给后端 (`crates/nsn/src/main.rs:1231`, `:1303`), 再继续 `while let Some(bytes) = data_rx.recv().await { ... }`。这保证 ClientHello 或 HTTP 请求行在后端看到完整字节流。

## 4. `handle_tcp_connection` — TCP 双向中继

```rust
// crates/proxy/src/tcp.rs:12
pub async fn handle_tcp_connection(
    mut incoming: impl AsyncRead + AsyncWrite + Unpin,
    target: SocketAddr,
    metrics: Arc<ProxyMetrics>,
) -> Result<(), Error> {
    metrics.active_connections.fetch_add(1, Ordering::Relaxed);
    metrics.total_connections.fetch_add(1, Ordering::Relaxed);

    let mut outgoing = TcpStream::connect(target).await?;
    let (tx, rx) = tokio::io::copy_bidirectional(&mut incoming, &mut outgoing).await?;

    metrics.bytes_tx.fetch_add(tx, Ordering::Relaxed);
    metrics.bytes_rx.fetch_add(rx, Ordering::Relaxed);
    metrics.active_connections.fetch_sub(1, Ordering::Relaxed);
    Ok(())
}
```

关键点:

- **泛型 incoming**: 入参是 `impl AsyncRead + AsyncWrite + Unpin`, 所以既能接受真实的 `TcpStream` (nsn 二进制通常不直接用它), 也能接受 `tokio::io::duplex` 测试通道 (见 `crates/proxy/src/tcp.rs:50`)。
- **复用 `copy_bidirectional`**: 双向复制由 tokio 提供, 一端 EOF 时自动半关, 任何一侧 `Err` 都返回 `Error::Io`。
- **指标单调递增 + 活跃计数回落到 0**: `ProxyMetrics` 定义在 `crates/telemetry`; `total_connections` 永不回退, `active_connections` 在函数退出前 `fetch_sub` (`crates/proxy/src/tcp.rs:25`)。

> 注意: `nsn/src/main.rs` 的三路 `relay_*_connection` **没有**直接调 `handle_tcp_connection`, 而是自己用两个 `tokio::spawn` 做 `data_rx` / `svc_tx` 的拷贝循环。原因是 smoltcp 侧是 mpsc 通道 (`data_rx: Receiver<Vec<u8>>`), 无法提供 `AsyncRead` 实现。`handle_tcp_connection` 目前主要服务于测试、以及其它可能出现的端到端 TCP 接管场景。

## 5. `handle_udp` — UDP 单流中继

```rust
// crates/proxy/src/udp.rs:14
pub async fn handle_udp(
    incoming: Arc<UdpSocket>,
    target: SocketAddr,
    metrics: Arc<ProxyMetrics>,
) -> Result<(), Error> {
    let outgoing = UdpSocket::bind("127.0.0.1:0").await?;
    outgoing.connect(target).await?;

    let mut buf = vec![0u8; 65536];
    loop {
        let (n, peer) = incoming.recv_from(&mut buf).await?;
        metrics.bytes_rx.fetch_add(n as u64, Ordering::Relaxed);

        outgoing.send(&buf[..n]).await?;
        let n = outgoing.recv(&mut buf).await?;
        metrics.bytes_tx.fetch_add(n as u64, Ordering::Relaxed);
        incoming.send_to(&buf[..n], peer).await?;
    }
}
```

设计约束:

- **请求/响应对齐**: 当前实现假设 UDP 流量是"一发一收", 适合 DNS 这类 query/response 协议; 对于持续双向 UDP (如 WebRTC) 会因为 `outgoing.recv` 阻塞主循环而不够用, 属于已知简化。
- **outgoing 自分配临时端口**: `bind("127.0.0.1:0")` 让内核分配源端口, `connect(target)` 之后才能用 `send`/`recv` 对称 API。
- **buffer 65 536**: 覆盖单个 UDP MTU 的最大值 (IPv4 限制), 避免分片错误。

## 6. 指标 (ProxyMetrics)

来自 `telemetry::metrics::ProxyMetrics`, 每个逻辑代理实例一个, 三个字段用原子操作累加:

| 字段 | 语义 |
|------|------|
| `active_connections` | 当前仍在 relay 的连接数 (TCP 调用 +1 / -1, UDP 不增减) |
| `total_connections` | 累计 TCP 连接数 |
| `bytes_tx` / `bytes_rx` | 累计向后端发送 / 从后端接收的字节 |

这些指标通过 `/api/nat` 与 Prometheus 输出, 详见 [07 · NSN 节点](../07-nsn-node/index.md) 的 telemetry 章节。

## 7. `Error` 类型

```rust
// crates/proxy/src/lib.rs:22
pub enum Error {
    Io(std::io::Error),       // TcpStream / UdpSocket 失败
    Refused(String),          // 预留: 显式拒绝 (目前未使用)
}
```

返回策略: `relay_*_connection` 把 `Err` 以 `tracing::warn!` 丢弃, 并不向上游返回 — 因为连接层面的错误 (后端不可达 / ACL 拒绝) 已经是"单条连接失败", 不应让整个 NSN 退出。

## 8. 为什么不做 `PROXY protocol`?

当前所有 relay 都**不注入 `PROXY` 协议头**, 后端看到的 peer 地址是 NSN 的出口 IP。对于需要真实客户端 IP 的场景 (如 audit 日志), 上游 (NSGW / NSC) 以及 `AppState.connections` 已经记录了原始 src_ip, 推荐在监控层聚合, 而不是在代理层改字节流。

## 9. 测试覆盖

| 文件 | 重点测试 |
|------|----------|
| `crates/proxy/src/tcp.rs:37` | 回显服务 + duplex 管道, 验证双向拷贝与三项指标 |
| `crates/proxy/src/tcp.rs:75` | 验证 `active_connections` 能回落到 0 |
| `crates/proxy/src/udp.rs:42` | UDP 回显 + 往返字节数统计 |
| `crates/proxy/src/http_peek.rs:31` | 大小写头名、端口剥离、二进制数据返回 `None` |
| `crates/proxy/src/sni_peek.rs:140` | 手工构造最小合法 ClientHello 验证 SNI 抽取 |

## 10. 后续阅读

- [http-host-routing.md](./http-host-routing.md) — `parse_http_host` 如何与 `resolve_by_host` 串起来
- [sni-routing.md](./sni-routing.md) — `parse_tls_sni` 与 `resolve_by_sni` 的链路
- [acl.md](./acl.md) — `ServiceRouter.resolve*` 中的 ACL 判决细节
