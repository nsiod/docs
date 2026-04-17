# Telemetry: OpenTelemetry + Prometheus

> 源码:
> - [`crates/telemetry/src/lib.rs`](../../../nsio/crates/telemetry/src/lib.rs) (51 行)
> - [`crates/telemetry/src/metrics.rs`](../../../nsio/crates/telemetry/src/metrics.rs) (115 行)
> - 装配: [`crates/nsn/src/main.rs:260-267`](../../../nsio/crates/nsn/src/main.rs) 与 [`monitor.rs:306`](../../../nsio/crates/nsn/src/monitor.rs)

`telemetry` 是 NSIO workspace 中最小的 crate（仅两个源文件、<200 行），其唯一职责是：
1. 初始化 OpenTelemetry (OTel) MeterProvider，并绑定 **Prometheus exporter**；
2. 定义 per-tunnel / per-resource 原子指标结构 (`TunnelMetrics` / `ProxyMetrics`) 给其他 crate 使用。

## 1. 架构

[telemetry crate 架构](./diagrams/telemetry-arch.d2)

完整 Metrics 采集暴露图：[`diagrams/metrics.d2`](./diagrams/metrics.d2)。

## 2. `init_telemetry()`

```rust
pub fn init_telemetry() -> Result<Registry, Error> {
    let registry = Registry::new();
    let exporter = opentelemetry_prometheus::exporter()
        .with_registry(registry.clone())
        .build()
        .map_err(|e| Error::Init(e.to_string()))?;
    let provider = SdkMeterProvider::builder().with_reader(exporter).build();
    opentelemetry::global::set_meter_provider(provider);
    Ok(registry)
}
```

([`lib.rs:31-40`](../../../nsio/crates/telemetry/src/lib.rs))

要点:

- 同一 `Registry` 被 exporter 持有 (`.clone()` 是 `Arc` 语义) 与 `nsn::main.rs` 持有 (返回值)，两侧共享一张指标表。
- 设置 **全局 MeterProvider**：任何 crate 调用 `opentelemetry::global::meter("crate_name")` 都走同一个 provider，记录的指标统一汇入 `registry`。
- 失败 (`Error::Init`) 只在 `nsn` 侧降级处理 ([`main.rs:261-267`](../../../nsio/crates/nsn/src/main.rs))：

  ```rust
  let metrics_registry = match telemetry::init_telemetry() {
      Ok(r) => std::sync::Arc::new(r),
      Err(e) => {
          tracing::warn!("telemetry init failed: {e}; metrics disabled");
          std::sync::Arc::new(prometheus::Registry::new())
      }
  };
  ```

  退化后 `/api/metrics` 仍可访问，但只有手写的 `nsn_*` 汇总指标会有输出。

## 3. `metrics.rs` 结构体

两个纯数据结构，全部字段均为 `std::sync::atomic::*`，适合高并发累加：

### 3.1 `ProxyMetrics`

```rust
pub struct ProxyMetrics {
    pub resource_id:        String,
    pub bytes_tx:           AtomicU64,
    pub bytes_rx:           AtomicU64,
    pub active_connections: AtomicU32,
    pub total_connections:  AtomicU64,
}
```

([`metrics.rs:4-10`](../../../nsio/crates/telemetry/src/metrics.rs))

### 3.2 `TunnelMetrics`

```rust
pub struct TunnelMetrics {
    pub tunnel_id:       String,
    pub wg_handshakes:   AtomicU64,
    pub wg_rx_bytes:     AtomicU64,
    pub wg_tx_bytes:     AtomicU64,
    pub last_handshake:  AtomicI64,   // unix secs，可以是 0
}
```

([`metrics.rs:26-32`](../../../nsio/crates/telemetry/src/metrics.rs))

> ⚠️ 注意 `telemetry::metrics::TunnelMetrics` (原子计数器) 与 `nsn::state::TunnelMetrics` (Monitor API 的 JSON 快照) 是两个不同类型。前者是累加源，后者是只读导出。

### 3.3 初始化

两个类型都提供 `new(id)` 将所有计数器初始化为 0 (`AtomicU64::new(0)` 等)，并在单元测试里验证 ([`metrics.rs:47-113`](../../../nsio/crates/telemetry/src/metrics.rs))。

## 4. Prometheus 暴露 — `/api/metrics`

`monitor::metrics_prometheus` ([`monitor.rs:306-376`](../../../nsio/crates/nsn/src/monitor.rs)) 将 OTel 指标 + 手写 `nsn_*` 汇总指标拼接成单一响应体：

```
HTTP/1.1 200 OK
Content-Type: text/plain; version=0.0.4; charset=utf-8

# OTel 通过 opentelemetry_prometheus 输出的指标...
(由 proxy / tunnel-wg 注入的 counter / gauge)

# 手写指标 (下表):
# HELP nsn_uptime_seconds Process uptime in seconds
# TYPE nsn_uptime_seconds gauge
nsn_uptime_seconds 12
...
```

### 4.1 手写指标清单

| 指标名 | 类型 | 含义 | 来源字段 |
| ------ | ---- | ---- | -------- |
| `nsn_uptime_seconds` | gauge | 进程 uptime | `state.start_time.elapsed().as_secs()` |
| `nsn_bytes_tx_total` | counter | 累计上行字节 | `nat_stats.bytes_tx` |
| `nsn_bytes_rx_total` | counter | 累计下行字节 | `nat_stats.bytes_rx` |
| `nsn_active_connections` | gauge | 当前活跃代理连接 | `connection_tracker.active_count()` |
| `nsn_connections_total` | counter | 代理连接累计 | `connection_tracker.total_count()` |
| `nsn_nat_active_entries` | gauge | NAT 映射活跃条目 | `nat_stats.active_entries` |
| `nsn_nat_entries_total` | counter | NAT 映射累计创建 | `nat_stats.total_created` |
| `nsn_gateways_connected` | gauge | 已连网关数量 | `gateway_states` 过滤 `status == "connected"` |
| `nsn_gateways_total` | gauge | 网关配置总数 | `gateway_states.len()` |
| `nsn_control_planes_connected` | gauge | 已连控制面数量 | `control_plane_states` 过滤 `status == "connected"` |

源码行号对应 [`monitor.rs:336-367`](../../../nsio/crates/nsn/src/monitor.rs)。

### 4.2 OTel 侧指标

OTel 部分由业务 crate 通过 `opentelemetry::global::meter(...)` 注入。

> ⚠️ **实现现状 (截至本文档版本)**：`telemetry::metrics::ProxyMetrics` / `TunnelMetrics` 这两个原子结构体定义完整且配有单元测试，但 **在当前 workspace 中尚未被任何业务 crate 实际引用**（grep `telemetry::metrics::` / `ProxyMetrics::new` / `TunnelMetrics::new` 在 `crates/proxy`、`crates/tunnel-wg` 中无命中）。这意味着：
>
> - 它们目前是 "预留容器"，不会产生 Prometheus 输出；
> - `/api/metrics` 中看到的 OTel 部分仅包含业务 crate 中已经直接调用 `opentelemetry::global::meter(...)` 注册的指标（若有）；
> - 手写的 `nsn_*` 指标 (§4.1) 是目前 `/api/metrics` 输出的稳定骨架。
>
> 如后续把 `ProxyMetrics` / `TunnelMetrics` 接入 OTel Observer，需在业务 crate 的初始化路径中新增 `meter.u64_observable_counter(...).with_callback(...)` 类调用。

## 5. 性能与并发

- 所有 `AtomicU64` / `AtomicU32` / `AtomicI64` 都使用 `Ordering::Relaxed`（源码中 tests 亦如此），这是计数器的惯用松序模型：
  - 单点自增 / 读取顺序对 Prometheus 抓取结果没有因果要求；
  - 避免跨 CPU 的 memory barrier 开销。
- `Registry` 共享 `Arc`：`nsn` 在启动后把 `Arc<Registry>` 放进 `AppState.metrics_registry` ([`state.rs:343`](../../../nsio/crates/nsn/src/state.rs))，Axum handler 直接 `state.metrics_registry.gather()`。
- 文本编码：`prometheus::TextEncoder::new().encode_to_string(&metric_families)` ([`monitor.rs:307`](../../../nsio/crates/nsn/src/monitor.rs))。

## 6. Prometheus 抓取示例

```yaml
# prometheus.yml
scrape_configs:
  - job_name: nsn
    scrape_interval: 15s
    static_configs:
      - targets: ['127.0.0.1:9090']
    metrics_path: /api/metrics
```

若 nsn 部署在内网，建议不要把 `127.0.0.1:9090` 改成 `0.0.0.0:9090`；可以用 NSN 本机上的 Prometheus agent 或 sidecar 抓取，再由该 agent 负责上报，避免未鉴权的 metrics 端点外暴。

## 7. 错误处理

`telemetry::Error::Init` ([`lib.rs:20-24`](../../../nsio/crates/telemetry/src/lib.rs)) 使用 `thiserror` 封装 exporter build 错误。主流程降级为空 `Registry` 的逻辑见 §2。

## 8. 相关文档

- [monitor-api.md](./monitor-api.md#apimetrics-prometheus) — `/api/metrics` 响应
- [health-monitor.md](./health-monitor.md) — `AppState.metrics_registry` 字段
- [../05-proxy-acl/](../05-proxy-acl/) — `ProxyMetrics` 的生产者
- [../03-data-plane/](../03-data-plane/) — `TunnelMetrics` 的生产者 (tunnel-wg)
