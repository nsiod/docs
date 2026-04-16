# NSIO 架构文档规划 (Coordinator Plan)

- Coordinator Issue: `5lbwr2xr` (project `w862z4u5` / nsio-doc)
- Source of Truth: `/app/ai/nsio` (Rust workspace, 12 crates + docs/)
- Output Root: `/app/ai/nsio-docs`
- Target readers: 产品设计者、系统架构师、新入职工程师

## 产出结构

```
nsio-docs/
├── PLAN.md                      # 本文件: 任务分派与进度跟踪
├── docs/
│   ├── 01-overview/             # [Sub-1] 系统总览 + NSIO 生态 + 数据流 + DNS 命名
│   ├── 02-control-plane/        # [Sub-2] NSN 侧 control / common / auth / SSE / 多 NSD
│   ├── 03-data-plane/           # [Sub-3] tunnel-wg / tunnel-ws / connector
│   ├── 04-network-stack/        # [Sub-4] netstack / nat
│   ├── 05-proxy-acl/            # [Sub-5] proxy (tcp/udp/sni/http) / acl
│   ├── 06-nsc-client/           # [Sub-6] nsc (VIP / DNS / Router)
│   ├── 07-nsn-node/             # [Sub-7] nsn binary / telemetry
│   ├── 08-nsd-control/          # [Sub-8]  NSD 控制中心 (独立组件 / 对端契约反推)
│   ├── 09-nsgw-gateway/         # [Sub-9]  NSGW 数据网关 (独立组件 / traefik + WG + WSS)
│   ├── 10-nsn-nsc-critique/     # [Sub-10] NSN+NSC 架构缺陷分析与改进 (反向审查)
│   └── 11-nsd-nsgw-vision/      # [Sub-11] NSD+NSGW 功能预测与生产化愿景 (前向设计)
└── web/                         # [Sub-12] ReactFlow 可视化静态站点 (pma-web)
```

## 4 大组件覆盖矩阵

| 组件 | 职责 | 本项目源码 | 对应子任务 |
|------|------|----------|-----------|
| **NSD** | 控制中心：认证/注册/策略/SSE 配置分发 | mock + tmp/control 参考 | Sub-8 (独立) + Sub-2 (对端契约) |
| **NSGW** | 数据网关：WG 端点 / WSS 中继 / traefik 反代 | mock + tmp/gateway 参考 | Sub-9 (独立) + Sub-3 (对端协议) |
| **NSN** | 站点节点：隧道客户端/ACL/服务路由 | 本项目主体 (12 crates) | Sub-2/3/4/5/7 (内部模块) |
| **NSC** | 用户客户端：虚 IP / 本地 DNS / Router | nsc crate | Sub-6 |

## 文档模板 (所有子任务必须遵循)

每个模块目录下输出:

```
<module>/
├── README.md                    # 概览 / 职责 / 对外接口 / 与其他模块关系
├── design.md                    # 设计决策 / 数据结构 / 关键算法 / 时序图
├── implementation.md            # 关键文件导读 / 代码结构 / 扩展点
└── diagrams/                    # Mermaid 源文件 + 可选 png
    └── *.mmd
```

写作要求:
- 英文或中文均可，但同一模块保持语言一致 (优先中文，对外术语保留英文)
- 必须包含 Mermaid 流程图/时序图 (后续 web 站点会复用)
- 引用源码位置使用 `crates/<name>/src/<file>.rs:<line>` 格式
- 不要直接复制 `/app/ai/nsio/docs/*` 内容，要重组/抽象/提升层次

## 任务分派进度

| # | 子任务 | Issue ID | 范围 | 状态 |
|---|--------|----------|------|------|
| 1 | 系统总览与架构 | `h8ajwg6a` | `docs/01-overview/` | **review ✓ GREEN** |
| 2 | NSN 控制面模块 | `ovuexop5` | `docs/02-control-plane/` | **review ✓ GREEN** |
| 3 | 数据面隧道 | `sawxbkvm` | `docs/03-data-plane/` | **review ✓ GREEN**（纠正源描述偏差）|
| 4 | 网络栈 | `j433sgk0` | `docs/04-network-stack/` | **review ✓ GREEN** |
| 5 | 代理与 ACL | `8qm9ytzv` | `docs/05-proxy-acl/` | **review ✓ GREEN** |
| 6 | NSC 用户客户端 | `ui4595pw` | `docs/06-nsc-client/` | **review ✓ GREEN** |
| 7 | NSN 节点与观测 | `jhfbw2tn` | `docs/07-nsn-node/` | **review ✓ GREEN**（P0×2+P1×3 自修）|
| 8 | **NSD 控制中心** | `5omjmvgc` | `docs/08-nsd-control/` | **review ✓ GREEN**（mock vs 生产对齐 + 多 NSD merge 语义）|
| 9 | **NSGW 数据网关** | `22gnmksa` | `docs/09-nsgw-gateway/` | **review ✓ GREEN**（纠正 IngressRoute 误指 + retry off-by-one）|
| 10 | **NSN+NSC 架构审查** (反向) | `yuh4832j` | `docs/10-nsn-nsc-critique/` | **review ✓ GREEN**（16 架构/28 功能/128 改进，83 源引用）|
| 11 | **NSD+NSGW 愿景设计** (前向) | `a65lpaun` | `docs/11-nsd-nsgw-vision/` | **review ✓ GREEN**（6+6 能力轴 + 173 行功能矩阵 + Phase 0-3 roadmap）|
| 12 | ReactFlow 可视化站点 | `pctsajua` | `web/` | **review ✓ GREEN**（pma-web 合规 + 17/22 总览图 + 72md/46mmd 全内联）|

## Sub-12 派发计划 (ReactFlow 可视化，等待 1-11 全部完成后触发)

派发时机：Sub 1-11 全部进入 `review` 状态。

技术栈：
- 使用 `pma-web` skill 脚手架
- Next.js (static export) 或 Vite + React
- ReactFlow + mermaid.js (渲染原生 .mmd 源)
- 可选: Fumadocs / Nextra 做 markdown 渲染
- 所有 docs/**/*.md 与 diagrams/*.mmd 作为内容源

功能：
1. 左侧导航按 01..11 模块组织（9 个模块 + 1 反向审查 + 1 前向愿景）
2. 每个模块页面内嵌 ReactFlow 节点图（从 .mmd 生成或手写 nodes/edges）
3. 顶层总览页面用大型 ReactFlow 展示 NSD/NSGW/NSN/NSC 四大组件生态关系
4. 节点可点击跳转到对应 markdown 内容
5. 改进/愿景页可切换 "现状 vs 改进 vs 愿景" 三态视图
6. `npm run build` 产出静态站点到 `web/dist/`

## 派发策略

- **阶段 A**: 并行派发子任务 1-9 (Simple mode, 文件范围互不重叠)
  - A1: Sub 1-7 (NSN 内部 + NSC，本项目源码)
  - A2: Sub 8-9 (NSD + NSGW，对端组件契约反推)
- **阶段 A'**: 基于 Sub-2..6 已产出文档追加派发
  - Sub-10 (NSN+NSC **反向审查**: 架构缺陷分析与改进)
  - Sub-11 (NSD+NSGW **前向愿景**: 功能预测与生产化设计)
- **阶段 B**: 子任务 1-11 全部进入 review 后，派发 Sub-12 (pma-web + ReactFlow)
- **阶段 C**: 所有子任务完成后，coordinator 进入 review，等待人工确认

## 文档体系的三层思考

| 层 | 性质 | 产物 |
|----|------|------|
| **描述层** | 忠实反映现状 | Sub-1 ~ Sub-9 |
| **批判层** | 反向审查，找结构性缺陷 | Sub-10 (NSN/NSC) |
| **预测层** | 前向设计，对齐生产级标杆 | Sub-11 (NSD/NSGW) |

描述层回答"它是什么"，批判层回答"它哪里有问题"，预测层回答"它应该成为什么"。三层共存才是完整的架构文档。
