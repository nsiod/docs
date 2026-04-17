# TLS SNI 路由 (`:443`)

> 源码: `crates/proxy/src/sni_peek.rs` (229 行, 含测试), `crates/nat/src/router.rs:162`, `crates/nsn/src/main.rs:1259`

NSN 在 `:443` 端口上**不**做 TLS 终止 — 证书始终在后端服务那边。NSN 只是读取 TLS ClientHello 里的明文 **SNI** 字段来决定往哪个后端转发, 一旦决定就把整段 ClientHello 及后续密文原样转发, 让客户端和后端自行完成 TLS 握手。

## 1. 链路总览

[SNI 路由链路总览](./diagrams/sni-routing-overview.d2)

完整时序见 [SNI 解析时序](./diagrams/sni-peek.d2)。

## 2. TLS ClientHello 字节布局

`parse_tls_sni` 需要穿过三层封装才能到达扩展表:

```
┌───────────────────────────┐  TLS Record (RFC 5246)
│ 0x16  content_type = 22   │  1 byte
│ 0x03 0x01  legacy version │  2 bytes  (TLS 1.0 封装, 内部可能是 1.2/1.3)
│ 0x??  length (big endian) │  2 bytes  (record body 长度)
├───────────────────────────┤
│ 0x01  handshake_type = 1  │  1 byte   Handshake message header
│ 0x?? 0x?? 0x??  uint24    │  3 bytes  (body length)
├───────────────────────────┤
│ client_version            │  2 bytes
│ random                    │  32 bytes
│ session_id_len + session  │  1 + N
│ cipher_suites_len + list  │  2 + 2k
│ compression_len + methods │  1 + M
│ extensions_len            │  2 bytes
│ extensions[]              │  剩余字节 (多条)
└───────────────────────────┘

每条 extension:
  ext_type   uint16
  ext_len    uint16
  ext_data   ext_len bytes

SNI extension (type = 0x0000) 的 data:
  server_name_list_length  uint16
  server_name_list[]:
    name_type  uint8   (0x00 = host_name)
    name_len   uint16
    name_bytes utf-8
```

对应源码分为三个小函数 (`crates/proxy/src/sni_peek.rs:19`, `:50`, `:93`):

| 函数 | 作用 |
|------|------|
| `parse_client_hello_body` | 校验 TLS Record 帧 + Handshake header, 返回 ClientHello body 切片 |
| `extract_sni_from_extensions` | 跳过 version / random / session_id / cipher_suites / compression, 到达 extensions 块 |
| `find_sni_in_extensions` | 遍历扩展列表, 找到 `ext_type == 0x0000`, 返回 `host_name` 条目 |

所有长度字段都做了越界判断, 不合法输入返回 `None` (见 `crates/proxy/src/sni_peek.rs:21,28,35,42,57,65,74,79,85,98,109,113,121` 的 `if .. return None`), 避免触发 panic。

辅助函数 `u24_be` (`crates/proxy/src/sni_peek.rs:135`) 处理 TLS 里少见的 3 字节大端整数。

> 整个 crate `#![forbid(unsafe_code)]`, 字节解析纯安全 Rust。TLS 1.3 向后兼容采用同样的 ClientHello 布局, 因此此函数同时适用于 1.2/1.3 明文握手部分。

## 3. `relay_https_connection` 链路

```rust
// crates/nsn/src/main.rs:1259
async fn relay_https_connection(conn: NewTcpConnection, router: Arc<ServiceRouter>) {
    let mut data_rx = conn.data_rx;
    let data_tx = conn.data_tx;

    let first = match data_rx.recv().await { Some(b) => b, None => return };
    let sni = match proxy::sni_peek::parse_tls_sni(&first) {
        Some(s) => s,
        None => { tracing::warn!(...); return; }
    };

    let resolved = match router.resolve_by_sni(conn.remote.ip(), conn.local.ip(), &sni).await {
        Some(r) => r,
        None => { tracing::warn!(...); return; }
    };
    let target = resolved.target;
    let stream = TcpStream::connect(target).await?;
    let (mut svc_rx, mut svc_tx) = tokio::io::split(stream);

    let to_svc = tokio::spawn(async move {
        if svc_tx.write_all(&first).await.is_err() { return; }      // 完整转发 ClientHello
        while let Some(bytes) = data_rx.recv().await {
            if svc_tx.write_all(&bytes).await.is_err() { break; }
        }
    });
    /* to_stack 方向同 HTTP 路由 */
}
```

和 [HTTP 路由](./http-host-routing.md#3-relay_http_connection-链路) 完全对称, 唯一差别是 peek 函数和 `find_named_by_sni` 里协议判断。关键不变式仍是:

1. **不终止 TLS**: 代理不持有证书, 也不解密应用数据, 只是字节管道;
2. **ClientHello 原样转发**: 后端需要完整 ClientHello 才能开始自己的握手, 否则会握手失败;
3. **peek 只看首个 chunk**: 通常一个 MSS 足以装下 ClientHello; 若 ClientHello 跨 chunk (极端场景), 解析会失败并丢弃该连接。

## 4. `ServiceRouter::resolve_by_sni` 的三件事

`crates/nat/src/router.rs:162` 的路径:

```
1. services.find_named_by_sni(sni)       # protocol=https && domain == sni
2. AclEngine.is_allowed({
     src_ip, dst_ip,
     dst_port: 443, protocol: Tcp,       # SNI 路由 ACL 固定 443/Tcp
   })
3. resolve_host(svc.host, svc.port)
```

`find_named_by_sni` (`crates/common/src/services.rs:384`) 的匹配规则:

- `s.protocol == Protocol::Https`;
- `s.domain.eq_ignore_ascii_case(sni)` (大小写无关, 精确匹配, 无通配符);
- 首个命中即返回。

`services.toml` 示例:

```toml
[services.api]
protocol = "https"
host = "192.168.1.5"
port = 443
domain = "api.internal.com"

[services.grafana]
protocol = "https"
host = "10.0.0.20"
port = 8443
domain = "grafana.example.com"
```

客户端只看到 NSN 的 `:443`, 内部可以分流到不同的后端端口 (443 / 8443) 而 ClientHello 所携带的 SNI 决定去向。

## 5. ACL 语义

SNI 路由进 ACL 时, `dst_port` **固定 443**, `protocol` **固定 Tcp** (`crates/nat/src/router.rs:183`)。策略写法与 HTTP 路由对称, 只是换成 `*:443`。

对 ACL 而言, SNI 本身**不参与决策** — ACL 只看 `(src_ip, dst_ip, dst_port, proto)`。如果业务需要按 SNI 限定访问者, 正确做法是把不同 SNI 的服务部署到**不同的 dst_ip (VIP)** 上, 或放到不同的 NSN 节点上, 然后在 ACL 用 `host alias` 细分 (参见 [acl.md §5](./acl.md#5-host-alias-展开))。

## 6. 常见错误与诊断

| 现象 | 可能原因 | 日志位置 |
|------|----------|----------|
| `HTTPS connection missing TLS SNI` | 客户端不发 SNI (例如旧式 curl `--no-ssl`), 或首包不是合法 TLS 握手 | `crates/nsn/src/main.rs:1274` |
| `no HTTPS service for SNI` | `services.toml` 没有 `protocol = "https"` + 匹配 `domain` | `crates/nsn/src/main.rs:1285` |
| `HTTPS relay connect failed` | 后端不可达 | `crates/nsn/src/main.rs:1294` |
| `ACL denied HTTPS connection` | ACL 未放行 `*:443`; 见 [acl.md](./acl.md) | `crates/nat/src/router.rs:187` |

## 7. 为什么不做证书透传或 ALPN 协商?

- **不终止 TLS** 的选择避免了 NSN 持有证书, 简化部署和合规 (证书只存在于真正的服务端)。
- **不读 ALPN**: NSN 只关心 SNI, 因此 HTTP/1.1、HTTP/2、gRPC-over-HTTPS、甚至非 HTTP 的 TLS 协议 (如 MQTT over TLS) 都能透传, 只要 SNI 对上即可。

## 8. 测试覆盖

| 位置 | 用例 |
|------|------|
| `crates/proxy/src/sni_peek.rs:198` | 手工构造最小合法 ClientHello, 验证 SNI 抽取 |
| `crates/proxy/src/sni_peek.rs:204` | HTTP 请求应返回 `None` (二进制判定失败) |
| `crates/proxy/src/sni_peek.rs:210` | 空 buffer |
| `crates/proxy/src/sni_peek.rs:215` | 截断到只剩 record header |
| `crates/proxy/src/sni_peek.rs:221` | 多级子域名 `internal.api.corp.example.com` |
| `crates/nat/src/router.rs` (`mod tests`) | `resolve_by_sni` 完整链路 |

## 9. 与 HTTP 路由的对称阅读

- [http-host-routing.md](./http-host-routing.md) — 对称路径, 换成明文 Host 头
- [acl.md](./acl.md) — 为什么 ACL 看 `*:443` 而非 SNI
- [proxy.md](./proxy.md) — relay 的底层 "字节进字节出" 原语
