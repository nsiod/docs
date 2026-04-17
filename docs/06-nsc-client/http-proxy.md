# 本地 HTTP 代理

> 位置：`crates/nsc/src/http_proxy.rs`。可选组件，由 `--http-proxy 127.0.0.1:8080` 开启。

## 为什么要有 HTTP 代理

VIP + 本地 DNS 已经可以让命令行工具透明访问远端服务，为什么还要 HTTP 代理？

1. **浏览器不走 `/etc/resolv.conf`**：Chrome / Firefox 通常自己做 DoH / DoT / secure DNS，绕过系统解析器，因此本地 DNS 对浏览器**无效**。HTTP 代理可以把浏览器的请求强制引过来。
2. **企业环境惯例**：开发者常已配置 `http_proxy` / `https_proxy` 环境变量，NSC 做成 HTTP 代理可以无缝融入现有工具链（curl / git / apt / docker login 等）。
3. **不想/不能改系统 DNS**：尤其 macOS 用户、CI 机器、Docker 容器内——只需 `HTTP_PROXY=127.0.0.1:8080` 即可。
4. **域名按需分流**：HTTP 代理**同时**处理 NSC 域名和普通域名——NSC 命中的走隧道，其他走直连。用户不必管理两个代理。

## 支持的请求形态

```
CONNECT foo.n.ns:22 HTTP/1.1       ← HTTPS / SSH / 任意 TCP 的隧道入口
GET http://foo.n.ns/path HTTP/1.1  ← 明文 HTTP 转发
POST / PUT / DELETE / HEAD / OPTIONS / PATCH 同上
其他方法 → 405 Method Not Allowed
```

（`crates/nsc/src/http_proxy.rs:113`）

## 分流决策

```mermaid
flowchart TD
  CLIENT[浏览器 / curl<br/>HTTP_PROXY=127.0.0.1:8080] --> ACCEPT[accept on 127.0.0.1:8080]
  ACCEPT --> PARSE[读第一行 request-line<br/>+ headers]
  PARSE --> METHOD{method?}

  METHOD -->|CONNECT| CP[parse host:port]
  METHOD -->|GET/POST/...| HP[parse_http_target]
  METHOD -->|其他| E405[405 Method Not Allowed]

  CP --> RES[resolve_target]
  HP --> RES

  RES --> Q1{NscRouter 命中<br/>(域名∈已知 site)?}
  Q1 -->|是| TUN["NscRouter.open_stream<br/>WSS + CMD_OPEN_V4<br/>直连 NSGW"]
  Q1 -->|否| Q2{host 是字面 IP?}
  Q2 -->|是| DIRECT_IP[目标 = IP:port<br/>OS 直连]
  Q2 -->|否| DNS[OS lookup_host<br/>第一个地址]
  DNS --> DIRECT[直连互联网]

  DIRECT_IP --> CONN[TcpStream::connect]
  DIRECT --> CONN

  TUN --> CK{method?}
  CONN --> CK
  CK -->|CONNECT| ACK[返回 200 Connection established]
  CK -->|plain HTTP| REWRITE[改写请求行: 绝对 URI → 相对 path]

  ACK --> BRIDGE[copy_bidirectional]
  REWRITE --> BRIDGE
```

### `resolve_target` 的优先级

```rust
// 1. NscRouter 命中 (domain ∈ 已知 site) → 直接打开一条 WSS 流到 NSGW
//    (不走本地 VIP listener, 不做 TcpStream::connect 到 127.11.x.x)
if let Some(site) = router.lookup_domain(&host.to_lowercase()) {
    return Target::Tunnel { site, host, port };
}

// 2. host 本身是字面 IP → OS 直连
if let Ok(ip) = host.parse::<IpAddr>() {
    return Target::Direct(SocketAddr::new(ip, port));
}

// 3. OS DNS 解析 → 第一个地址, 直连互联网
match tokio::net::lookup_host(...).await { ... }
```

**关键**:第 1 步查 NSC 自己的路由表(`NscRouter` + `DnsRecords`)。HTTP 代理直接读,**不发** DNS 查询。因此:

- NSC 命中的域名**立刻**进入"直连 NSGW"分支,不产生任何 DNS 流量,也不会在本机回环上多跳一次;
- 未命中的域名走 OS 解析(libc / resolver),和用户本机默认一致。

### 直连 NSGW(无本地 VIP 中转)

命中 NSC 的流量**不经过** `127.11.x.x` VIP listener——HTTP 代理直接调 `NscRouter::open_stream(site, host:port)` 向 NSGW 开一条 WSS 逻辑流:

```
browser → NSC HTTP proxy (127.0.0.1:8080)
        ↓ NscRouter::open_stream(site, host:port)
        ↓ WSS + CMD_OPEN_V4 (host:port, tcp)
        → NSGW → NSN → 本地服务
```

这样做的理由:

- **零回环跳**:旧的"browser → 127.0.0.1:8080 → 127.11.0.1:80 → WSS" 双跳会多出一次 TCP 状态机 + 一次内存拷贝,纯属浪费;
- **目标语义更精确**:VIP listener 对每个 `(site, port)` 硬编码一个监听口,无法表达"任意 port / 任意 host"——HTTP CONNECT 经常点到非标准端口(`ssh.site.n.ns:2222`、`git.site.n.ns:8443`),走直连 WSS 以 `(host, port)` 为单位开流,**不要求** NSC 预先为该端口分配 listener;
- **和 VIP 路径解耦**:VIP listener 继续服务非 HTTP 协议(SSH/DB/Redis 的客户端会自己 DNS 解析 → TCP connect,仍然落在 VIP)。两个入口共用 `NscRouter` 的路由决策,但各自握住自己的 socket。

VIP listener 与 HTTP 代理的分工:

| 入口 | 启动门槛 | 目标表达能力 | 命中时的下游 |
|------|----------|--------------|---------------|
| VIP listener(`127.11.x.x:port`) | 需预先为 `(site, port)` 分配 listener | 仅预分配过的端口集合 | `NscRouter::open_stream` → WSS |
| HTTP 代理(`127.0.0.1:8080`) | 单 listener 通吃所有 `(host, port)` | 任意 port、任意 host(含非 n.ns 的直连 fallback) | 命中 NSC 时直接 `NscRouter::open_stream` → WSS;未命中走 OS 直连 |

两者**共用同一个 `NscRouter`**,路由不会不一致;但 HTTP 代理**不复用** VIP 的 socket——它独立打流。

## `CONNECT` 流程

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant HP as NSC HTTP proxy<br/>127.0.0.1:8080
  participant R as NscRouter
  participant GW as NSGW
  participant NSN

  B->>HP: CONNECT ssh.office.n.ns:22 HTTP/1.1
  HP->>HP: 读 headers，丢到空行
  HP->>R: lookup_domain("ssh.office.n.ns") → site=office
  HP->>GW: WSS + CMD_OPEN_V4 (ssh.office.n.ns:22, TCP)<br/>(NscRouter.open_stream)
  GW->>NSN: relay (stream_id 映射)
  NSN-->>GW: OpenAck
  GW-->>HP: OpenAck
  HP-->>B: HTTP/1.1 200 Connection established\r\n\r\n
  Note over B,NSN: 双向透传（copy_bidirectional），本代理无状态
```

**注意**:sequence 里**没有** VIP listener 这一跳——`NscRouter::open_stream` 直接返回一个 `WssStream` 读写句柄,HTTP 代理拿它和 browser socket 做 `copy_bidirectional`。旧版本"HP → 127.11.0.1:22"的 TCP 中转已经删除。

对 HTTPS 的处理完全透明——客户端发出的 TLS 握手直接被隧道转发到远端服务，NSC 不解包、不看内容、不做 MITM。

## 明文 `GET` 流程（绝对 URI）

浏览器/curl 发出 `GET http://foo.n.ns/path HTTP/1.1`，NSC 需要把它改写成 `GET /path HTTP/1.1` 再发给上游（否则远端服务看到绝对 URI 会不认识）。

请求改写逻辑（`crates/nsc/src/http_proxy.rs:178`）：

1. 解析绝对 URI → `(host, port, path)`；
2. `resolve_target` 拿 SocketAddr；
3. TCP 连上游；
4. 重建 request：
   - 请求行：`{METHOD} {path} HTTP/1.1\r\n`；
   - 复制原 headers，但丢弃 `Proxy-Connection:` / `Proxy-Authorization:`；
   - 若原 headers 没有 `Host:`，追加 `Host: {host}\r\n`；
   - 最后 `Connection: close\r\n\r\n`（简化 relay 生命周期）。
5. `copy_bidirectional` 透传 body 和响应。

### 边缘情况

| 情况 | 行为 |
|---|---|
| `GET /path HTTP/1.1`（相对路径，未经代理标准协议） | `parse_http_target` 返回 `("localhost", 80, "/path")`，走直连 localhost |
| `GET https://foo.com/...` 进代理 | 当前实现会按 HTTP 处理（`parse_http_target` 只看 scheme 是否有 `http://` 或 `https://`，后者也接受），但**不会**建立 TLS；浏览器/客户端一般不会这么发，它们对 HTTPS 总是用 `CONNECT` |
| IPv6 字面地址 `[::1]:8080` | `parse_host_port` 支持；`parse_http_target` 未处理方括号，需要通过 `CONNECT` 用 |
| 上游连接失败 | 返回 `502 Bad Gateway` |
| `parse_host_port` 失败 | 返回 `400 Bad Request` |
| 其他方法 | `405 Method Not Allowed` |

## 使用示例

```bash
# 启动 NSC 并打开 HTTP 代理
nsc --auth-key cloud.nsio=key-xxx --http-proxy 127.0.0.1:8080

# 浏览器：设置系统代理为 127.0.0.1:8080 即可
# 命令行：
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080
curl http://web.ab3xk9mnpq.n.ns     # 命中 NSC → VIP → WSS → NSN
curl http://example.com             # 未命中 → 直连
```

## 与 VIP 直连方式的对比

| 场景 | VIP 直连（`127.11.0.1:22`） | HTTP 代理（`127.0.0.1:8080`） |
|---|---|---|
| 是否需要改客户端配置 | 改 DNS(默认 `127.53.53.53`,或 `--dns-listen` 覆盖值) 或 `/etc/hosts` | 改 `http_proxy` / `https_proxy` 环境变量或系统代理 |
| 浏览器可用性 | 可能被 secure DNS 绕过 | 100% 生效 |
| 非 HTTP 协议（SSH/DB/Redis） | 直接可用 | 可用（通过 `CONNECT`） |
| 运维复杂度 | 需修改系统 resolver | 零系统改动 |
| 下游通道 | TcpStream 进入 VIP listener → WSS | 直接调 `NscRouter::open_stream` → WSS |
| 适合场景 | 命令行为主的服务器/开发机 | 浏览器 + 多样化工具链 |

两者**不互斥**——可以同时启用,共用 `NscRouter` 的路由决策,但各自独立打 WSS 流(HTTP 代理不经过 VIP listener)。

## 代码引用

- 入口：`crates/nsc/src/http_proxy.rs:40` (`run_http_proxy`)
- 请求解析：`crates/nsc/src/http_proxy.rs:71` (`handle_client`)
- `CONNECT` 隧道：`crates/nsc/src/http_proxy.rs:136` (`handle_connect`)
- 明文 HTTP 转发：`crates/nsc/src/http_proxy.rs:178` (`handle_http`)
- 目标解析（含 NSC DNS 查表）：`crates/nsc/src/http_proxy.rs:245` (`resolve_target`)
- `host:port` 解析：`crates/nsc/src/http_proxy.rs:270`
- 绝对 URI 解析：`crates/nsc/src/http_proxy.rs:288`
- 主循环启动：`crates/nsc/src/main.rs:230`
