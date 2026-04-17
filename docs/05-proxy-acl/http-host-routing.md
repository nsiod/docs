# HTTP Host 路由 (`:80`)

> 源码: `crates/proxy/src/http_peek.rs` (71 行), `crates/nat/src/router.rs:117`, `crates/nsn/src/main.rs:1187`

NSN 在 `:80` 端口按 HTTP/1.x 请求里的 `Host:` 头选择后端服务, 使得同一个 NSN 可以承载多个虚拟主机 (`web.example.com`, `admin.example.com`) 而无需各自分配端口。

## 1. 链路总览

[HTTP Host 路由链路总览](./diagrams/http-routing-overview.d2)

完整时序见 [HTTP Host 解析时序](./diagrams/http-peek.d2)。

## 2. `parse_http_host` 协议解析

HTTP/1.1 请求的 `Host` 头在请求行后的任意 header 位置出现一次, 例:

```
GET /api/login HTTP/1.1\r\n
Host: admin.example.com:80\r\n
User-Agent: curl/8.6.0\r\n
Connection: close\r\n
\r\n
```

`parse_http_host` 的实现 (`crates/proxy/src/http_peek.rs:11`):

```rust
pub fn parse_http_host(data: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(data).ok()?;
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("host:") {
            let value = line[5..].trim();
            let host = value.split(':').next().unwrap_or(value);
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
    }
    None
}
```

解析约束:

| 规则 | 细节 |
|------|------|
| UTF-8 | 整个 buffer 必须是合法 UTF-8, 否则直接返回 `None` (二进制 TLS ClientHello 会被自动识别失败) |
| 大小写无关 | `HOST:`, `Host:`, `host:` 均接受 (`crates/proxy/src/http_peek.rs:44`) |
| 端口剥离 | `example.com:80` → `example.com` (`crates/proxy/src/http_peek.rs:18`) |
| 第一个命中即返回 | 不处理多 `Host` 头的病态请求, 实际规范也不允许 |
| 空值 → `None` | `"Host:   "` 被认为缺失 (`crates/proxy/src/http_peek.rs:19`) |

> 函数本身**不做 URL 解码、不改写请求行、不缓冲后续数据**。调用方需要把首个 chunk **原样**转发给后端, 见下一节。

## 3. `relay_http_connection` 链路

```rust
// crates/nsn/src/main.rs:1187
async fn relay_http_connection(conn: NewTcpConnection, router: Arc<ServiceRouter>) {
    let mut data_rx = conn.data_rx;
    let data_tx = conn.data_tx;

    let first = match data_rx.recv().await { Some(b) => b, None => return };
    let host = match proxy::http_peek::parse_http_host(&first) {
        Some(h) => h,
        None => { tracing::warn!(...); return; }
    };

    let resolved = match router.resolve_by_host(conn.remote.ip(), conn.local.ip(), &host).await {
        Some(r) => r,
        None => { tracing::warn!(...); return; }
    };
    let target = resolved.target;
    let stream = TcpStream::connect(target).await?;
    let (mut svc_rx, mut svc_tx) = tokio::io::split(stream);

    // 关键: 先把 first chunk 完整写给后端, 再继续 relay
    let to_svc = tokio::spawn(async move {
        if svc_tx.write_all(&first).await.is_err() { return; }
        while let Some(bytes) = data_rx.recv().await {
            if svc_tx.write_all(&bytes).await.is_err() { break; }
        }
    });
    let to_stack = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match svc_rx.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => { if data_tx.send(buf[..n].to_vec()).await.is_err() { break; } }
            }
        }
    });
    let _ = tokio::join!(to_svc, to_stack);
}
```

关键不变式:

1. **非阻塞降级**: 任一环节失败 (`Host` 缺失 / 无匹配 service / `connect` 失败) 都只 `tracing::warn!` 并丢弃本连接, 不影响其它连接。
2. **原字节转发**: `svc_tx.write_all(&first).await` 保证后端看到完整请求行和所有头, 代理本身是 L7 "透明"的 — 不会重写 `Host`、不会去掉 `Connection: close` 等头。
3. **单 chunk peek**: 解析器只看 `data_rx.recv()` 的第一个 chunk。对于 HTTP/1.1 实际够用 (单次 MSS 即可塞下完整请求行和头块), 如果客户端极端分包使得 `Host` 不在首 chunk, 会被判为"缺失" — 这是当前简化。

## 4. `ServiceRouter::resolve_by_host` 的三件事

`crates/nat/src/router.rs:117` 做完以下三步:

```
1. services.find_named_by_domain(host)         # 查找 protocol=http && domain == host 的 ServiceDef
2. AclEngine.is_allowed(AccessRequest {
      src_ip, dst_ip,
      dst_port: 80, protocol: Tcp,             # 域名路由时 ACL 固定看 80/Tcp
   })
3. resolve_host(svc.host, svc.port)            # IP 直用, 域名调 tokio::net::lookup_host
```

`find_named_by_domain` (`crates/common/src/services.rs:358`) 的匹配规则:

- `s.protocol == Protocol::Http` — 必须是 http 协议的服务 (不是 tcp)
- `s.domain.eq_ignore_ascii_case(host)` — 大小写无关的精确匹配 (**不支持通配符**)
- 首个命中的 `(name, service)` 被返回

对应的 `services.toml` 示例 (来自 `docs/task/HTTP-001.md`):

```toml
[services.web]
protocol = "http"
host = "127.0.0.1"
port = 80
domain = "web.example.com"

[services.admin]
protocol = "http"
host = "10.0.0.5"
port = 8080
domain = "admin.example.com"
```

注意 **后端的真实端口与 80 无关**: `web` 走 `127.0.0.1:80`, 而 `admin` 被代理到 `10.0.0.5:8080`, 但客户端两者都是访问 NSN 的 `:80`。

## 5. ACL 在 HTTP 路由中的语义

域名路由进 ACL 时, `dst_port` **固定为 80**, `protocol` **固定为 Tcp** (`crates/nat/src/router.rs:138`)。这意味着:

- ACL 策略写 `*:80` 或 `*:*` 就能允许所有 HTTP 路由连接;
- 如果策略只允许 `*:8080`, 即便服务 `admin` 的后端端口是 `8080`, **也会被拒绝** — ACL 看的是"客户端想访问的端口", 不是"后端实际端口"。

这与端口路由 (`resolve`) 保持一致: ACL 校验建立在"虚拟 endpoint" 上, 而不是"真实 backend"上, 这样策略不会随后端迁移而失效。

## 6. 常见错误与诊断

| 现象 | 可能原因 | 日志 |
|------|----------|------|
| `HTTP connection missing Host header` | 请求是 HTTP/0.9 或首包里没有 `Host:` | `crates/nsn/src/main.rs:1202` |
| `no HTTP service for Host` | `services.toml` 没有 `protocol = "http"` + 对应 `domain` | `crates/nsn/src/main.rs:1213` |
| `HTTP relay connect failed` | 后端 TCP 连接失败 (端口关 / 网络) | `crates/nsn/src/main.rs:1222` |
| `ACL denied HTTP connection` | ACL 未放行 `src_ip → *:80`; 见 [acl.md](./acl.md) | `crates/nat/src/router.rs:142` |

## 7. 测试覆盖

| 位置 | 用例 |
|------|------|
| `crates/proxy/src/http_peek.rs:31` | 简单 Host / 端口剥离 / 大小写无关 / 缺失 / 空 / 二进制 / 多服务 |
| `crates/common/src/services.rs` (`find_by_domain` 相关) | 大小写无关匹配 |
| `crates/nat/src/router.rs` | `resolve_by_host` 经 ACL + DNS 的完整链路 (见 `mod tests`) |

## 8. 与 SNI 路由的对称性

HTTP (`:80`, Host 头, 明文) 与 HTTPS (`:443`, SNI, TLS ClientHello) 在 NSN 侧实现**完全同构**: 首包 peek → `resolve_by_*` → 原样转发 → 双向 relay。差别只在 peek 函数与 `find_named_by_*` 里协议字段的不同 (`Http` vs `Https`)。请对照 [sni-routing.md](./sni-routing.md) 阅读。
