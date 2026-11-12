# TabPilot

一个自用的 Firefox 标签页管理器：用 JSON 规则把 URL 匹配到「分组 + 颜色 + 折叠」，收编掉当前零散安装的多个标签管理插件。

- **技术栈**：原生 WebExtensions（HTML / CSS / JS）+ Manifest V3，无构建、无框架
- **目标浏览器**：Firefox 139+（仅此，多浏览器为后续计划）
- **存储**：`browser.storage.local`，统一走封装层
- **隐私**：纯本地运行，无任何网络请求上传数据
- **版本**：遵循 [SemVer](https://semver.org/lang/zh-CN/) 三段式 `MAJOR.MINOR.PATCH`

> **当前状态**：`v0.3.0` 已实现配置导入 / 导出（导出 JSON 文件、复制 JSON、导入校验并替换配置、导入后自动同步），`v0.2.0` 的两栏配置页与 `v0.1.0` 的规则引擎均已在 Firefox 实机验证通过。配置结构为 `schemaVersion 2`，v1 旧配置自动迁移。共 78 个单元测试。其余功能仍在规划中，详见下方[功能清单](#功能清单与实现状态)与[版本规划](#版本规划)。

---

## 要解决的问题

现状是用多个独立插件分别实现「标签页分组、高亮、重命名」，代价是：

1. **零碎** —— 规则散落在多个插件，行为不一致，难以统一调整。
2. **不可控** —— 无法集中定义「什么 URL 进什么组、什么颜色」。
3. **不可迁移** —— 配置无法备份 / 恢复，换机器成本高。
4. **权限冗余** —— 多个插件叠加申请权限，隐私面扩大。

目标是用一个自制插件以**统一规则引擎**覆盖 80% 高频场景，其余低频操作保留手动。

## 目标与非目标

**v1.0.0 目标**

- 用 JSON 规则定义「URL 匹配 → 分组 / 颜色 / 折叠」
- 规则可启用 / 禁用、有优先级、支持导入导出
- 有操作日志，能排查「哪个 tab 命中哪条规则、做了什么」
- 连续使用一周，可卸载至少一个现有旧插件

**本阶段明确不做**

- 多浏览器（Chrome / Edge / Safari）兼容
- 复杂图形化规则编辑器（第一版用 JSON textarea）
- 云同步、账号体系
- 机器学习 / 智能推荐规则
- 任何形式的数据上传

## 核心场景

| # | 场景 | 期望行为 |
|---|---|---|
| S1 | 打开 `localhost:*` 调试服务 | 自动进入「开发」组，绿色 |
| S2 | 打开 GitHub / GitLab | 自动进入「代码」组，蓝色 |
| S3 | 打开 Jira / Confluence | 自动进入「工作」组，橙色 |
| S4 | 同域名标签过多 | 可选：同一窗口内命中该规则的标签数达到该规则自定义阈值（`match.minTabs`）时才归组 |
| S5 | 临时不想被自动分组 | 可禁用单条规则或全局暂停 |
| S6 | 换机器 | 导出 JSON 配置，新机器导入 |

## 功能清单与实现状态

| 编号 | 功能 | 优先级 | 状态 |
|---|---|---|---|
| F1 | 规则引擎自动分组：监听 `tabs.onCreated` / `tabs.onUpdated`，防抖合并、按优先级匹配、幂等执行、单条异常不影响其他标签 | P0 | **已完成（v0.1.0）**，单测 + Firefox 实机验证 |
| F1b | 全量同步：把**已打开**的标签页按规则过一遍（事件监听管不到它们）。改配置后自动执行，工具栏按钮可手动触发；默认跳过已在分组内的标签 | P0 | **已完成（v0.1.0）**，单测 + Firefox 实机验证 |
| F2 | 分组属性设置：名称、颜色（Firefox 预设色）、是否折叠；已有组按规则增量更新 | P0 | **已完成（v0.1.0）**，名称与颜色已实机验证；折叠未单独验证 |
| F3 | 规则管理：两栏配置页——左栏只读分组列表（选中、⋯ 排序/删除），右栏编辑分组名/颜色/启停 + 多条匹配路径/阈值/折叠/备注、全局暂停 | P1 | **已完成（v0.2.0）**：Firefox 实机验证通过；保存前校验并高亮出错分组，`TabPilotDebug` 控制台入口保留用于调试 |
| F4 | 配置导入 / 导出：导出 JSON 文件、复制 JSON、导入时校验 `schemaVersion` 与字段、覆盖前确认、导入后自动同步 | P1 | **已完成（v0.3.0）**，待 Firefox 实机确认 |
| F5 | 操作日志：记录时间、URL、命中规则、动作、结果 / 错误 | 开发期辅助 | **不做独立日志页**。`explain()` 的 steps 已在控制台输出，足够排查「为什么没进组」；内存环形缓冲保留供调试 |
| F6 | 标签页重命名（实验）：content script 改 `document.title`，失败静默降级 | P2 | 规划中（v1.1.0），不阻塞 v1.0.0 |

**验收标准（F1）**：打开 3 个 `localhost` 页面，自动进入同一「开发」组、绿色，控制台各打印一条命中记录。

## 规则怎么写

配置页左侧是分组列表，选中某个分组后在右侧编辑；一条规则对应一个分组，等价的结构（`schemaVersion: 2`）是：

```json
{
  "id": "code-github",
  "enabled": true,
  "name": "代码",
  "color": "blue",
  "collapsed": false,
  "minTabs": 3,
  "note": "代码托管：攒够 3 个再归组",
  "patterns": ["*://*.github.com/*", "*://gitlab.com/*"]
}
```

- **一条规则 = 一个标签页分组**：分组名、颜色、折叠都是规则自身的字段。
- `patterns` 是匹配路径列表，**任意一条命中即算命中**，所以同一个分组可以覆盖多个站点或路径前缀。
- **顺序即优先级**：规则在数组里的顺序就是匹配顺序，靠前的先命中；配置页用 ↑ / ↓ 调整。
- **匹配路径可以直接写简写**，离开输入框或保存时会自动补全（`expandPattern`）：
  - 不带协议 → 补 `*://`（同时匹配 http 与 https）
  - 只写主机、没有路径 → 同时展开「任意端口」和「无端口」两种：`192.168.3.213` → `*://192.168.3.213:*/*`、`*://192.168.3.213/*`
  - 已经写了端口（`localhost:3000`）→ 不再展开端口变体
  - 结尾不是 `/*` → 自动补成 `/*`（`https://example.com/foo` → `https://example.com/foo/*`）
  - 已经是完整模式时保持不变（幂等）
- 展开后的路径只支持 `*` 通配，其余字符按字面量处理；`*.github.com` 同时匹配裸域名 `github.com` 与所有子域名（与浏览器 match pattern 语义一致），不带 `*.` 的 `github.com` 只匹配该主机本身。
- `minTabs` 是**分组阈值**，默认 `1`（命中即归组）。设为 N 时，只有同一窗口内命中该规则的标签页数量 ≥ N 才归组；未达阈值会继续尝试后面的规则。
- 阈值达成时会**一起归组**：同窗口内命中该规则、且尚未归入任何分组的标签会被一并移入目标组。已经在别的分组里的标签不会被拽出来。
- 一个标签页最多命中一条规则。
- `color` 取值：`grey` `blue` `red` `yellow` `green` `pink` `purple` `cyan` `orange`。

## 数据模型

配置存放在 `tabpilot:config`，`schemaVersion` 为 `2`：

```json
{
  "schemaVersion": 2,
  "globalEnabled": true,
  "rules": [
    {
      "id": "dev-localhost",
      "enabled": true,
      "name": "开发",
      "color": "green",
      "collapsed": false,
      "minTabs": 1,
      "note": "本地开发环境",
      "patterns": ["*://localhost:*/*"]
    }
  ]
}
```

- 未存过配置或配置校验失败时，插件回退到内置默认配置（即上面这条 `dev-localhost`）。
- 旧的 `schemaVersion: 1` 配置（`match.urlPattern` + `actions[]` + `priority`）会在读取时**自动迁移**到 v2 并写回：单条路径转成 `patterns` 数组，`actions[0]` 的分组属性提到规则上，旧 `priority` 降序转成数组顺序。
- `schemaVersion` 是**配置格式版本**，只在结构不兼容变更时递增，与插件版本号无关。

## 架构与目录

```
manifest.json          MV3，background.scripts（非 service worker）
src/
  background.js        事件监听 + 防抖调度：唯一做编排的地方
  rules.js             纯函数规则引擎：match / explain，可脱离浏览器单测
  actions.js           动作执行：唯一调用 tabs.group / tabGroups.* 的层
  store.js             存储封装：storage.local 读写 + schema 校验 + 默认配置
  logger.js            日志：控制台 + 内存环形缓冲（定位为开发调试辅助，不做独立日志页）
  options.html         配置页：两栏布局（左分组列表 / 右分组详情）
  options.js           配置页逻辑（选中、排序、删除、路径编辑与补全、校验提示、保存后请求同步）
test/
  rules.test.js        规则匹配、优先级、阈值、窗口隔离
  store.test.js        配置校验（含 minTabs / 颜色 / 重复 id）与 JSON 解析
  background.test.js   编排链路：事件、同步、工具栏、消息、调试入口
docs/PRD.md            需求、场景、架构、版本规划的完整依据
```

分层意图：规则引擎与 `browser.*` 解耦（只吃 tab / rules / context），存储层可整体替换，动作为唯一直接碰浏览器分组 API 的地方。以后换 IndexedDB、加 Chrome 兼容层都只改一层。

## 版本规划

| 版本 | 内容 | 状态 |
|---|---|---|
| v0.1.0 | 规则引擎 + 内置默认 `localhost` →「开发」组绿色 + 控制台日志 + 全量同步（工具栏按钮） | 已完成，Firefox 实机验证通过 |
| v0.2.0 | 配置页两栏布局：左栏只读分组列表（选中、⋯ 排序/删除），右栏编辑分组名/颜色/启停 + 多匹配路径（含自动补全）、阈值、折叠、备注；全局开关 + 保存前校验 + 保存后自动同步；配置结构升级到 `schemaVersion 2` 并自动迁移旧配置 | 已完成，Firefox 实机验证通过 |
| v0.3.0 | 配置导入 / 导出：导出 JSON 文件、复制 JSON、导入校验（v1 自动迁移）、覆盖确认、导入后自动同步 | 已实现（本地预览验证），待 Firefox 确认 |
| v0.4.0 | 按容器 / 窗口区分规则 | 规划中 |
| v1.0.0 | 稳定自用一周，卸载至少一个旧插件 | 规划中 |
| v1.1.0+ | 标签页重命名实验、按容器 / 窗口区分规则 | 规划中 |

## 本地加载与验证

1. `about:support` 确认 Firefox 版本 ≥ 139（`tabGroups` API 依赖）。
2. 打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择本目录的 `manifest.json`。
3. 打开 3 个 `localhost` 页面，预期全部进入「开发」组且为绿色。
4. 在 `about:debugging` 里点插件的「检查」，控制台应能看到每次命中的 `[TabPilot] ... 命中规则并执行动作`。
5. `about:addons` → TabPilot → 「首选项」打开配置页，加一条 github 规则（`minTabs: 3`）并保存，确认保存后已有标签立刻被同步。

### 同步已打开的标签页

事件监听只覆盖「之后新发生的变化」，**已经开着的标签永远不会被处理**。两种触发方式：

- 改配置后自动同步：`TabPilotDebug.setConfig(...)` 保存成功后会立刻全量同步一遍。
- 手动同步：点工具栏上的 TabPilot 按钮（`default_title: "TabPilot：立即同步标签页"`），或在控制台执行 `await TabPilotDebug.syncAll()`。

默认**跳过已经在分组里的标签**，避免把手动整理过的标签拽回规则组；需要强制全量重排时用 `await TabPilotDebug.syncAll({ includeGrouped: true })`。同步结束会打印一行 `同步完成：检查 N 个，归组 A 个，跳过 S 个，失败 F 个`。

### 配置页（v0.2.0）

三种打开方式：

1. `about:addons` → TabPilot → **「首选项」**
2. 扩展调试控制台执行 `await browser.runtime.openOptionsPage()`（也可用 `TabPilotDebug.openOptions()`）
3. 直接访问 `moz-extension://<扩展 UUID>/src/options.html`

页面是两栏布局：

- **左栏：分组列表（只读）**。每行只有色块、分组名、iOS 风格拨杆（表示启用状态，不可点击）和 ⋯；点行选中分组，选中项左侧有高亮条，停用的分组名字带删除线。⋯ 菜单可上移 / 下移（**顺序即优先级，靠上的先匹配**）或删除。
- **右栏：选中分组的详情**，按行组织：
  - 第一行：分组名（固定约 240px 宽）、颜色、阈值、启用、命中后折叠。颜色是自带色块的自绘下拉；启用与折叠是 iOS 风格拨杆，和其他字段一样**文字在上、控件在下**，所以整行底边对齐。
  - 第二行：备注，可拖动缩放的文本域。
  - 再往下是匹配路径（可增删、支持简写自动补全），底部「该分组的更多设置」为标签页重命名、页面内高亮标识预留了位置（标注「规划中」）。

顶部工具栏是全局开关与 `保存并同步` / `放弃修改` / `恢复默认`；保存失败会逐条列出字段错误（如 `rules[0].name 必须是非空字符串`）并高亮左侧对应分组。保存成功会写回 storage 并立刻同步已打开的标签页；`Ctrl/Cmd + S` 也能保存。

### 备份与迁移（v0.3.0）

配置页底部「备份与迁移」提供三个操作：

| 操作 | 行为 |
|---|---|
| 导出 JSON 文件 | 下载 `tabpilot-config-YYYYMMDD.json`，内容为当前编辑状态（含未保存的修改） |
| 复制 JSON | 把同样的内容写入剪贴板，方便直接粘到另一台机器 |
| 导入 JSON… | 选择文件后先校验（含 v1 自动迁移），确认后**替换**当前配置、立即保存并同步已打开的标签页 |

导入失败时逐条列出校验错误（如 `rules[1].patterns[0] 必须是非空字符串`），不会改动现有配置。

### 控制台方式（保留，供调试）

配置页之外，`TabPilotDebug` 仍可直接操作配置：

| 操作 | 命令 | 语义 |
|---|---|---|
| 增/改一条规则 | `await TabPilotDebug.addRule(rule)` | 按 `id` 去重后追加，**其余规则保留**；保存后自动同步 |
| 删一条规则 | `await TabPilotDebug.removeRule(id)` | 只删指定规则 |
| 整份替换 | `await TabPilotDebug.setConfig(config)` | **覆盖**整个配置，不合并；保存后自动同步 |
| 查看当前生效配置 | `await TabPilotDebug.getConfig()` | 返回 `{ config, source, errors? }` |
| 恢复默认 | `await TabPilotDebug.resetConfig()` | 删除存储的配置，回到内置默认 |

重要区别：**默认规则（`dev-localhost`）只在「storage 里没有配置」时作为兜底生效**，一旦写入过配置，它就只是被写入内容的一部分。所以 `setConfig` 只写 github 一条规则时，localhost 不再自动归组；想两条都在，用 `addRule` 或一次写全。

## 开发

```bash
npm test        # 运行规则引擎、配置校验与编排链路的单测
```

- 无依赖、无构建，浏览器里直接加载源码目录。
- 改版本号时同步 `manifest.json` 与 `package.json` 两处。
- 有单测的是纯逻辑（规则引擎、配置校验与解析、编排链路）；`options.js` 是纯 DOM 绑定，改动后按上节手动确认页面与保存流程。

**排查「某个 tab 为什么没归组」**：在扩展的调试控制台（`about:debugging` → 「检查」）里执行：

```js
(async () => {
  const { config, source, errors } = await TabPilotStore.loadConfig();
  console.log('配置来源:', source, '校验错误:', errors ?? '无');
  console.table(config.rules.map((r) => ({
    id: r.id, enabled: r.enabled, priority: r.priority,
    pattern: r.match.urlPattern, minTabs: r.match.minTabs ?? 1
  })));
  const tabs = await browser.tabs.query({ currentWindow: true });
  console.table(tabs.map((t) => ({ id: t.id, groupId: t.groupId, url: t.url })));
  for (const t of tabs) {
    const { matched, steps } = TabPilotRules.explain(t, config.rules, { tabs, windowId: t.windowId });
    console.log(t.url, '→', matched ? '命中 ' + matched.ruleId : '未命中', steps);
  }
})();
```

`steps` 里 `urlMatched: false` 表示模式没匹配上；`thresholdMet: false` 且 `count < minTabs` 表示数量没达到阈值。

## 已知限制

- 分组 API 已在 Firefox 实机验证可用（`tabs.group` + `tabGroups.update`）；不支持该 API 的版本会打印明确日志而不是抛错。
- MV3 后台是事件页，会被回收：日志的内存缓冲、防抖队列都是易失状态。日志只作为开发期排查手段（控制台），不做落盘。
- 临时加载的扩展在**浏览器重启或重新载入后消失，storage 也随之清空**：用配置页底部「备份与迁移」导出 JSON，重载后导入即可恢复。
- 规则匹配不做容器（Container Tabs）区分，见 v1.1.0 规划。

## 许可证

[MIT](LICENSE)
