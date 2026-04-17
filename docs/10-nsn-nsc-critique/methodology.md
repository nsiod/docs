# 方法论 · 审查维度 / 严重度定级 / 评分标准

> 本文档定义 `docs/10-nsn-nsc-critique/` 系列文档使用的严重度等级、审查维度、缺陷记录格式，以及"什么是结构性缺陷、什么只是未完成实现"的判别原则。所有后续文档遵守本文。

## 1. 审查目标与边界

| 项 | 内容 |
|----|------|
| 审查对象 | `crates/nsn`、`crates/nsc` 及其依赖的 10 个内部 crate（`acl`/`common`/`connector`/`control`/`nat`/`netstack`/`proxy`/`telemetry`/`tunnel-wg`/`tunnel-ws`） |
| 审查不包括 | NSD（控制中心）、NSGW（网关）的内部实现细节；这些被视为黑盒契约方 |
| 审查视角 | "如果我是接手 NSN+NSC 的架构师" — 关心**结构、契约、扩展性、失败模式**，不挑细枝末节风格问题 |
| 输入证据 | `crates/**/*.rs` 源码（commit 当前 HEAD）+ `docs/01..09` 已 GREEN 文档 |
| 不做的事 | 修源码 / 改其他 docs/ / 给出"重写一份"的乌托邦设计 |

## 2. 严重度等级

[严重度等级 · P0/P1/P2/P3 与处理动作](./diagrams/severity-levels.d2)

| 等级 | 触发条件 | 示例（不必全部满足，命中任一即升级） |
|------|----------|--------------------------------------|
| **P0** | 1) 默认开启时**有未授权访问**或**数据丢失**；2) 某种正常输入会**panic 整个进程**；3) 长时运行**必然 OOM / 死锁 / 雪崩** | "ACL 未加载窗口里 ServiceRouter 默认放行" / "conntrack 无回收无上限" |
| **P1** | 1) 抽象边界错位、两套并存的真理源；2) 故障**无降级路径**、错误吞掉；3) **可扩展性**被结构限制（加一种 transport / 一类 ACL 就要动 5 处）；4) 安全控制存在**窗口期** | "register/heartbeat 走明文 HTTP 而控制流走 Noise" / "MultiNSD ACL 取交集" |
| **P2** | 1) 重复代码 / 重复路径（两份 TCP relay）；2) 配置无验证、参数硬编码；3) 关键路径缺指标；4) 测试覆盖与生产路径偏离 | "nsn/main.rs 的 relay_*_connection 与 proxy::handle_tcp_connection 两套" |
| **P3** | 命名不准、注释过期、未导出但应导出、minor 风格 | "AclFilteredSend 文档说会做 ACL 检查实际只过滤 IP 协议号" |

定级原则：**一次只定一个等级**，多重影响时取最高。等级**不与修复成本挂钩** — 一个 P0 也可能 5 行代码搞定，一个 P3 可能要重写 200 行；优先级 = 严重度 ÷ 成本，是 [improvements.md](./improvements.md) 的事。

## 3. 审查维度

每个缺陷必须落在以下维度之一（也可跨维度，但主类目唯一）：

| 维度 | 提问 | 输出文档 |
|------|------|---------|
| **架构** | 抽象、耦合、模块边界是否清晰？换掉一个组件代价多大？ | [architecture-issues.md](./architecture-issues.md) |
| **功能** | 文档/接口承诺的能力实际兑现了吗？哪些是"半成品" | [functional-gaps.md](./functional-gaps.md) |
| **失败模式** | 错误如何传播？有没有降级、隔离、限流？雪崩半径多大？ | [failure-modes.md](./failure-modes.md) |
| **性能** | 锁竞争、阻塞、零拷贝、内存模型；可量化的性能假设是否成立？ | [performance-concerns.md](./performance-concerns.md) |
| **可观测性** | 出问题时 SRE 能看到什么？指标 / tracing / 调试输入足够吗？ | [observability-gaps.md](./observability-gaps.md) |
| **安全** | 信任边界、密钥生命周期、放行窗口、降级攻击 | [security-concerns.md](./security-concerns.md) |

## 4. 缺陷记录格式（强制）

每条缺陷在文档中以下面 9 字段记录：

```markdown
### CRIT-001 · <一句话缺陷标题>
- **Severity**: P0
- **Location**: `crates/nat/src/router.rs:88-101`
- **Current**: 一段描述现状（不抄文档，描述代码实际行为）
- **Why a defect**: 为什么这是结构性问题而不是 bug；从架构视角解释
- **Impact**: 谁在什么场景下被影响；最坏情况是什么
- **Fix**: 落地到接口/类型/契约级别（不能是"加强一下"）
- **Cost**: 估计需要改动的范围（文件/接口数）+ 是否破坏兼容
- **Benefit**: 修完之后获得什么；是否解锁后续工作
- **Risk**: 修这个本身的副作用 / 引入回归的可能
```

**ID 命名规则**：

| 前缀 | 维度 |
|------|------|
| `ARCH-` | architecture-issues |
| `FUNC-` | functional-gaps |
| `FAIL-` | failure-modes |
| `PERF-` | performance-concerns |
| `OBS-`  | observability-gaps |
| `SEC-`  | security-concerns |

ID 在所属文档内连续编号（`ARCH-001`、`ARCH-002` …），不跨文档。

## 5. "结构性缺陷" vs "未完成实现" 判别

这是本审查最容易混淆的二分。判别规则：

| 类别 | 判定 | 处理 |
|------|------|------|
| **结构性缺陷** | 即使把所有 TODO 写完、把所有 unimplemented 实现，问题**仍然存在** | 进入本目录文档，需要设计层面改动 |
| **未完成实现** | 写完缺失的 N 行代码就消失，不需要重新设计任何接口 | 仅在 [functional-gaps.md](./functional-gaps.md) 列出，不进入 architecture-issues |

举例：

- `ConntrackTable` 没有 GC → **结构性**（需要设计 TTL 策略 / 容量上限 / 驱逐算法 / metrics）
- `nsc --device-flow` 未实现 → **未完成**（已有 device_flow crate，调一下就能跑）
- `nat::ServiceRouter` ACL=None 时 fail-open，而 `tunnel-ws::check_target_allowed` 同条件 fail-closed → **结构性**（两条路径有两套语义，需要统一约定）
- NSC TUN 模式只换了 VIP 前缀没建 TUN → **结构性**（接口承诺与实现不符，且补全意味着引入特权模式分支）

## 6. 量化方法（性能主张）

涉及性能断言时必须给出可执行的验证路径，否则降级为"猜测"。常用方法：

| 主张类型 | 验证手段 |
|---------|---------|
| 锁竞争 | `parking_lot::deadlock` 检测；或 `tokio-console` 任务调度可视化 |
| 拷贝量 | `cargo flamegraph` + `Vec::with_capacity` 命中率；或 heap profiler（`dhat`） |
| 阻塞点 | `tokio-console` 显示长时间 busy poll；`tracing` `Span::busy()` 时长 |
| backpressure | `mpsc::Sender::try_send` 失败计数；channel `len()/capacity()` 比 |
| 吞吐 | `criterion` 微基准 + 端到端 Docker E2E 中 `iperf3` 走 WSS |

性能主张未给出可量化路径的，本审查标注 "**性能直觉，未验证**" 而不当成结论。

## 7. 引用与可追溯性

- 所有源码引用使用 `crates/<name>/src/<file>.rs:<line>` 格式
- 引用的行号必须在当前 HEAD 实际存在；本审查交叉验证过的行号在文中**直接引用**，未交叉验证的标 `(approx)`
- 引用同级文档使用相对链接 `./xxx.md` 或 `../NN-xxx/index.md`
- 图表源码同级提供 `.d2` 文件，便于二次编辑

## 8. 审查者立场说明

本系列文档的隐含读者是：

- **NSN/NSC 当前维护者**：希望用最小代价知道下一步该改哪里
- **接手新人/技术决策人**：希望快速识别"这套设计的脆弱点在哪"，而不是被乐观的架构图欺骗
- **同类项目的工程师**：希望从 NSIO 的取舍中借鉴或避坑

本审查**不**做下面的事：

- 给整体打分（"7/10"这种缺乏证据的总结无价值）
- 与 tailscale/nebula/zerotier 做"谁更优"的横评（只在改进方案里引用其某个具体决策做对比）
- 提出"重写一切"方案（重写不是审查师能负责的决策）

## 9. 参考的同项目文档

本审查信任以下兄弟文档作为现状描述：

| 文档 | 状态 | 用途 |
|------|------|------|
| [../01-overview/index.md](../01-overview/index.md) | GREEN | 总览 / 四组件职责 |
| [../02-control-plane/index.md](../02-control-plane/index.md) | GREEN | 控制面契约 |
| [../03-data-plane/index.md](../03-data-plane/index.md) | GREEN（已校正源项目失真） | 隧道形态 |
| [../04-network-stack/index.md](../04-network-stack/index.md) | GREEN | smoltcp + NAT |
| [../05-proxy-acl/index.md](../05-proxy-acl/index.md) | GREEN | proxy + ACL |
| [../06-nsc-client/index.md](../06-nsc-client/index.md) | GREEN | NSC 客户端 |
| [../07-nsn-node/index.md](../07-nsn-node/index.md) | GREEN | NSN 节点生命周期 |

当源码与上述文档冲突时，**以源码为准**，并在缺陷记录中显式指出文档失真。
