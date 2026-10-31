# dsh-workspace-resizer

给 DeepSeek Harness 侧边栏加一条**可拖动分隔条**，夹在「全局面板导航」（插件 / 插件市场 / 自动化任务 / …）和「工作区」会话区之间。

## 为什么需要

侧边栏是一列 flex 布局：导航 `flex: none` 且自身不滚动，工作区 `flex: 1` 吃掉剩下的全部高度。窗口不高时，七八行导航会把高度占满，工作区只剩两三百像素，会话列表必须滚动才能看全。原先没有调整手段——要腾地方只能改窗口大小，或者去「更多」里逐个取消固定导航项。

## 用法

- **拖动** 分隔条：向上拖 → 导航变矮、内部自己滚动，工作区立刻拿到省下来的高度；向下拖 → 导航变高。
- **双击** 分隔条恢复默认布局。
- 键盘：分隔条聚焦后 `↑` / `↓` 微调（`Shift` 加大步长），`Home` 或 `0` 恢复默认。

拖动结果存在浏览器 `localStorage`（键 `dsh.workspace-resizer.navHeight`），重启沿用。默认不动布局——装好之后什么都不变，直到你第一次拖动。

## 在「插件」面板里的显示

侧边栏点「插件」进插件管理页，这个插件会以一张卡片出现，卡片上写的名字和一句话说明来自 `locale/*.json`：

| 字段 | 中文 | English |
| --- | --- | --- |
| 标题 | 工作区分隔条 | Workspace splitter |
| 说明 | 上拖细线，让工作区会话列表变高 | Drag the line above it to grow the workspace list |
| 图标 | `icon.svg` | — |

面板读的是 `package.json` 的 `icon` 字段与 `locale/<语言>.json` 里的 `meta.title` / `meta.description`（见 `@deepseek-ai/dsh-app-boot` 的 `readPluginMeta`），缺失时回退到包名 + `package.json` 的 `description`。说明在卡片上**只显示一行**并截断，所以文案刻意压短。

## 改了源码之后

pnpm 把这个 `file:` 依赖按硬链接铺进 profile，改动源文件会换掉 inode，装好的那份**不会**跟着变。改完要同步一次：

```bash
bash C:/Users/siyin/Documents/deepseek-harness/default-workspace/_test/sync-plugin.sh
```

同步后重启应用（宿主每次列插件都会重读这些元数据，但客户端脚本要重新加载才生效）。

## 实现

`lib/client.js`，纯客户端；宿主半 `lib/index.js` 是空插件。

- 不依赖任何构建期 hash 的 class 名（`.wtg9ga_*` 之类跨版本会变）。定位靠结构特征：flex 列容器里那个带多个按钮的 `<nav>`，紧邻的兄弟是 `overflow: hidden` + `flex-grow: 1` 的工作区容器。找不到就静默不做事。
- 只改 `nav` 的 inline `max-height` / `overflow-y`，工作区靠原有 `flex: 1` 自动变大——不碰 React 管理的节点结构，不插入新节点（分隔条挂在 `body` 上，`position: fixed` 跟着导航底边）。
- DOM 变化只做一次廉价的连通性检查，重新定位交给 `ResizeObserver` / `resize`，避免聊天流式输出时每帧强制排版。

## 已知限制

- 侧边栏收起成图标条时，分隔条自动隐藏。
- 工作区至少保留 132px、导航至少保留 34px，超出范围会被夹住。
- 依赖侧边栏当前的结构（`<nav>` + `flex:1` 的工作区容器）。DSH 大版本改了侧边栏结构的话，插件会静默失效而不是报错。
