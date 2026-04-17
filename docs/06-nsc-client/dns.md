# 本地 DNS

> 关注：OS resolver → NSC DNS → VIP 的解析链路、监听点选择、回退策略、wire format 细节。

## 解析链

```mermaid
sequenceDiagram
  autonumber
  actor User as 应用进程<br/>(ssh / curl / psql)
  participant LIBC as libc / OS resolver<br/>(/etc/resolv.conf)
  participant NSC_DNS as NSC DNS<br/>127.0.0.53:53
  participant STORE as DnsRecords<br/>(Arc<RwLock<HashMap>>)
  participant UPSTREAM as 1.1.1.1:53

  User->>LIBC: getaddrinfo("ssh.office.n.ns")
  LIBC->>NSC_DNS: UDP A query
  NSC_DNS->>STORE: read().get("ssh.office.n.ns")
  alt 命中
    STORE-->>NSC_DNS: 127.11.0.1
    NSC_DNS-->>LIBC: A 127.11.0.1 (TTL 60)
  else miss
    NSC_DNS->>UPSTREAM: 转发原始 query
    UPSTREAM-->>NSC_DNS: 上游响应
    NSC_DNS-->>LIBC: 原样透传
  end
  LIBC-->>User: 127.11.0.1
  User->>User: TCP connect 127.11.0.1:22 → 进入 proxy 听
```

关键事实：

- NSC DNS 是**必经路径**。`/etc/resolv.conf` 里需要把 `nameserver 127.0.0.53` 放在最前（或通过 systemd-resolved 配置 stub resolver）。NSC 本身**不修改**系统配置，由用户或部署脚本负责。
- 未命中的查询**原样转发**到 `1.1.1.1:53`，不做 split-horizon。对于普通域名行为和本机默认解析一致。
- 所有查询都走 UDP，包 ≤512 字节。不支持 TCP fallback、不支持 EDNS、不支持 DNSSEC。

## 监听地址

```rust
// 默认值（crates/nsc/src/dns.rs:18）
pub const DNS_LISTEN_DEFAULT: &str = "127.0.0.53:53";
const UPSTREAM_DNS: &str = "1.1.1.1:53";
const UPSTREAM_TIMEOUT_SECS: u64 = 2;
```

选 `127.0.0.53:53` 作为默认值的理由：

- 和 systemd-resolved 的 stub resolver 地址一致——多数 Linux 发行版默认的 `/etc/resolv.conf` 第一条就是它。
- `127.0.0.x` 是环回,无须 root。端口 53 是 DNS 标准端口,保证 `resolv.conf` 零改写。

### 监听地址可配置

如果 `127.0.0.53:53` 已被 systemd-resolved / dnsmasq / 其它本机 resolver 占用,可通过 CLI 或配置覆盖:

| 来源 | 形式 | 示例 |
|------|------|------|
| CLI 参数 | `--dns-listen <addr:port>` | `nsc --dns-listen 127.0.0.153:5353` |
| 环境变量 | `NSC_DNS_LISTEN` | `NSC_DNS_LISTEN=127.0.0.254:53` |
| 配置文件 | `[dns] listen = "..."` | 同上 |

优先级:CLI > 环境变量 > 配置文件 > 默认值。绑定失败时打印诊断(显示冲突进程提示,由 `lsof -i :53` 或 `ss -lntup` 辅助定位):

```
cannot bind DNS server on 127.0.0.53:53 — another resolver may be running
hint: use `--dns-listen 127.0.0.153:5353` or stop the conflicting service
```

> **提示**:改了监听地址后,系统 `/etc/resolv.conf`(或对应平台机制)也要跟着指到新地址,否则应用仍然问默认 resolver,就绕过 NSC 了。这一步**NSC 不自动做**——见下文"已知限制"。

- **macOS**:没有 systemd-resolved,需要通过 `/etc/resolver/` 的 per-domain 配置把 `*.n.ns` 指向 NSC 监听地址。当前代码未处理这一点,由用户/部署脚本负责。

## 记录来源

`DnsRecords` 是一个共享的 `Arc<RwLock<HashMap<String, Ipv4Addr>>>`，两条路径会往里写：

### 路径 1: `routing_config` 自动派生（主要来源）

主循环在收到 `RoutingConfig` 时，对每条 `RouteEntry` 执行：

```rust
if let Some(vip) = r.vip_for_site(&entry.site) {
    dns.insert(entry.domain.to_lowercase(), vip);
}
```

见 `crates/nsc/src/main.rs:258`。域名由 NSD 生成，形如 `{service}.{site}.n.ns`（见 [01 概述里的 DNS 命名约定](../01-overview/index.md)或 `/app/ai/nsio/docs/dns-naming.md`）。

### 路径 2: `dns_config` 显式下发（自定义域）

NSD 管理员可以配置额外的公共域名，同样映射到某个 site 的 VIP：

```
dns_records: [
  { domain: "git.company.com", site: "office", ... },
  { domain: "wiki.company.com", site: "office", ... },
]
```

处理在 `crates/nsc/src/main.rs:279`。对每条 `DnsRecord`：

```rust
if let Some(vip) = r.vip_for_site(&rec.site) {
    dns.insert(rec.domain.to_lowercase(), vip);
} else {
    warn!("DNS record for unknown site (no VIP allocated yet)");
}
```

**注意顺序问题**：如果 `dns_config` 先于对应 site 的 `routing_config` 到达，这条 DNS 记录会被丢弃并打 warn。NSD 侧应保证推送顺序，或等下一轮 `dns_config` 重试。

### 命名形态

```
web.ab3xk9mnpq.n.ns      ← NSD 自动生成：{service}.{node_id}.n.ns
git.company.com          ← dns_config 手配
OFFICE.N.NS              ← 查询时大小写不敏感（handle_query 会 to_lowercase）
```

## 协议实现

DNS wire format 手写，不依赖 `trust-dns-*` 等库（避免引入近千依赖）。完整实现在 `crates/nsc/src/dns.rs`，约 200 行有效代码。

### 支持的查询

- **QTYPE=1 (A)** 和 **QTYPE=255 (ANY)**：会命中查表；
- 其他 QTYPE（AAAA / MX / TXT / SRV / …）：不命中直接转发上游；
- **QR=1（响应包）**：忽略；
- **QDCOUNT=0**：忽略；
- **压缩指针（0xC0…）** 在 question 部分：直接报错（NSC 只接受首个 label-by-label 编码的 QNAME）。

### 响应构造

`build_a_response`（`crates/nsc/src/dns.rs:172`）：

```
Header:
  ID          = 原 query ID
  Flags       = 0x8400 | (RD_bit_from_query)     // QR=1, AA=1
  QDCOUNT = 1, ANCOUNT = 1, NSCOUNT = 0, ARCOUNT = 0

Question: 从原 query 直接拷贝（12 到 question_end_abs 字节）

Answer RR:
  NAME      = 0xC0 0x0C (压缩指针，指向 offset 12 处的 QNAME)
  TYPE      = 1 (A)
  CLASS     = 1 (IN)
  TTL       = 60 秒
  RDLENGTH  = 4
  RDATA     = 4 字节 IP
```

TTL 固定 60 秒——NSC 希望 VIP 变动（重启）后客户端能很快拿到新值。对绝大多数 NSC 用户，这些记录几乎总是被命中的（应用一直在访问同一个站点）。

### 并发模型

- 单个 `UdpSocket` 收所有查询；
- 每个查询 `tokio::spawn` 一个独立 task 处理（`crates/nsc/src/dns.rs:60`）——这样上游慢或超时不会阻塞后续查询；
- 记录表使用 `Arc<RwLock<HashMap>>`：写者是主循环（低频），读者是每个 DNS 请求（高频），RwLock 能让读并发。

### 上游转发

```rust
async fn forward_query(query: &[u8]) -> Result<Vec<u8>>
```

见 `crates/nsc/src/dns.rs:204`。流程：

1. 新开一个临时 `UdpSocket::bind("0.0.0.0:0")`；
2. `send_to(query, "1.1.1.1:53")`；
3. `recv_from` 包到 512-byte 缓冲区；
4. 2 秒超时后放弃（`tokio::time::timeout`）。

上游地址 `1.1.1.1:53` 当前是硬编码（`UPSTREAM_DNS` 常量），未来可以做成配置或从 NSD 下发。

## 与应用路径的协作

DNS 只是第一步；解析完成后应用会向 VIP 发 TCP，由 [proxy 模块](./router.md)接管。两者通过共享的 `DnsRecords` 和 `NscRouter` 状态协调：

- **HTTP 代理侧** (`crates/nsc/src/http_proxy.rs:245`)：直接读 `DnsRecords`，命中就把目标从 `host` 换成 `vip`；未命中走 OS 解析直连。详见 [http-proxy.md](./http-proxy.md)。
- **VIP 代理侧** (`crates/nsc/src/proxy.rs`)：不依赖 DNS——它只监听 VIP:port，应用在 DNS 解析后**必然**命中该 listener。

## 已知限制

| 项 | 现状 | 影响 |
|---|---|---|
| IPv6 | 不支持 AAAA 命中 | 应用必须能 fall back 到 IPv4 |
| TCP DNS | 不支持 | 极少触发（响应包永远 ≤512 bytes） |
| EDNS0 | 不支持 | 某些客户端可能发 OPT 记录，上游转发时会带过去 |
| DNSSEC | 不支持 | 不验证上游签名 |
| mDNS / LLMNR | 不拦截 | `*.local` 查询不经 NSC（由 avahi/resolved 处理） |
| 上游 timeout | 硬编码 2s | 上游慢链路下可能 false-negative |
| `/etc/resolv.conf` 自动配置 | NSC 不改 | 需用户/部署脚本把监听地址(默认 `127.0.0.53`,或 `--dns-listen` 指定值)放到首位 |

## 代码引用

- 入口：`crates/nsc/src/dns.rs:30` (`run_dns_server`)
- 查询处理：`crates/nsc/src/dns.rs:87` (`handle_query`)
- 上游转发：`crates/nsc/src/dns.rs:204` (`forward_query`)
- 响应构造：`crates/nsc/src/dns.rs:172` (`build_a_response`)
- 记录更新（主循环）：`crates/nsc/src/main.rs:258`（来自 routing）、`crates/nsc/src/main.rs:281`（来自 dns_config）
