# 99 · Excalidraw 演示（沙盒）

本节演示如何把 `.excalidraw` 源文件接入 rspress 的静态构建管线 —— 与 `.d2` 同款做法，用于在需要"手绘风/自由排版"图示时作为 d2 的补充。

## 管线

1. 在 [excalidraw.com](https://excalidraw.com) 绘制并导出 `.excalidraw`（JSON 源文件，File → Save to... 或拷贝后粘贴为 .excalidraw）
2. 提交到 `docs/<section>/diagrams/*.excalidraw`
3. `bun run build:excalidraw`（已串入 `dev`/`build`）遍历所有 `.excalidraw`，渲染成 `docs/public/<同路径>.svg`
4. `scripts/remark-excalidraw-include.mjs` 在 mdx 编译阶段把 `[描述](./diagrams/foo.excalidraw)` 形式的 inline link 替换为 `<img>`

## 示例

下面一行 markdown 的 link 被 remark 插件替换为下方的 SVG：

```md
[NSIO 数据面链路示意](./diagrams/demo.excalidraw)
```

[NSIO 数据面链路示意](./diagrams/demo.excalidraw)

## 渲染器说明

`scripts/build-excalidraw.mjs` 是一个 **零运行时依赖** 的极简 Excalidraw → SVG 渲染器，只覆盖 rectangle / ellipse / diamond / line / arrow / text 六种形状，用于演示管线形态。

- 优点：CI 里不需要额外安装 Chromium 或 jsdom，体积为零
- 缺点：不支持 Excalidraw 的 hachure 填充、roughjs 手绘风格、元素 binding、freedraw 等完整特性

若需要完整保真，把 `scripts/build-excalidraw.mjs` 替换为调用 `@excalidraw/excalidraw` 的 `exportToSvg` 方案（需要 `jsdom` 或 headless Chromium）即可，remark 插件和目录约定保持不变。
