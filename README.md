# TabPilot

一个自用的 Firefox 标签页管理器：用 JSON 规则把 URL 匹配到「分组 + 颜色 + 折叠」，收编掉当前零散安装的多个标签管理插件。

- **技术栈**：原生 WebExtensions（HTML / CSS / JS）+ Manifest V3，无构建、无框架
- **目标浏览器**：Firefox 139+（仅此，多浏览器为后续计划）
- **存储**：`browser.storage.local`，统一走封装层
- **隐私**：纯本地运行，无任何网络请求上传数据
- **版本**：遵循 [SemVer](https://semver.org/lang/zh-CN/) 三段式 `MAJOR.MINOR.PATCH`

> **当前状态**：`v0.5.0` **标签页名规则**已实现——每个分组可配置多条命名规则（源文本正则、目标文本、描述），按顺序匹配、命中第一条即停止；配置页带多行测试区域，测试文本随配置保存。`v0.1.0`–`v0.4.0` 的规则引擎、两栏配置页、导入导出、页面内标识均已在 Firefox 实机验证。配置结构为 `schemaVersion 5`，v1–v4 旧配置自动迁移。共 125 个单元测试。其余功能仍在规划中，详见下方[功能清单](#功能清单与实现状态)与[版本规划](#版本规划)。

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
- 规则可启用 / 禁用、顺序即优先级、支持导入导出
- 能在控制台排查「哪个 tab 命中哪条规则、做了什么」（不再单独做日志页）
- 连续使用一周，可卸载至少一个现有旧插件

**本阶段明确不做**

- 多浏览器（Chrome / Edge / Safari）兼容
- 更复杂的规则编辑器（条件组合、表达式、自由画布；当前两栏表单已够用）
- 云同步、账号体系
- 机器学习 / 智能推荐规则
- 按域名细分统计标签数（阈值按规则整体计数即可）
- 任何形式的数据上传

## 核心场景

| # | 场景 | 期望行为 |
|---|---|---|
| S1 | 打开 `localhost:*` 调试服务 | 自动进入「开发」组，绿色 |
| S2 | 打开 GitHub / GitLab | 自动进入「代码」组，蓝色 |
| S3 | 打开 Jira / Confluence | 自动进入「工作」组，橙色 |
| S4 | 同一分组规则命中的标签过多 | 可选：同一窗口内命中该规则的标签数达到规则阈值（`minTabs`）时归组；**按规则整体计数，不按域名细分** |
| S5 | 临时不想被自动分组 | 可禁用单条规则或全局暂停 |
| S6 | 换机器 | 导出 JSON 配置，新机器导入 |

## 功能清单与实现状态

| 编号 | 功能 | 优先级 | 状态 |
|---|---|---|---|
| F1 | 规则引擎自动分组：监听 `tabs.onCreated` / `tabs.onUpdated`，防抖合并、按优先级匹配、幂等执行、单条异常不影响其他标签 | P0 | **已完成（v0.1.0）**，单测 + Firefox 实机验证 |
| F1b | 全量同步：把**已打开**的标签页按规则过一遍（事件监听管不到它们）。改配置后自动执行，工具栏按钮可手动触发；默认跳过已在分组内的标签 | P0 | **已完成（v0.1.0）**，单测 + Firefox 实机验证 |
| F2 | 分组属性设置：名称、颜色（Firefox 预设色）、是否折叠；已有组按规则增量更新 | P0 | **已完成（v0.1.0）**，名称与颜色已实机验证；折叠未单独验证 |
| F3 | 规则管理：两栏配置页——左栏只读分组列表（选中、⋯ 排序/删除），右栏编辑分组名/颜色/启停 + 多条匹配路径/阈值/折叠/备注、全局暂停 | P1 | **已完成（v0.2.0）**：Firefox 实机验证通过；保存前校验并高亮出错分组，`TabPilotDebug` 控制台入口保留用于调试 |
| F4 | 配置导入 / 导出：导出 JSON 文件、导入时校验 `schemaVersion` 与字段、覆盖前确认、导入后自动同步（入口在顶部工具栏） | P1 | **已完成（v0.3.0）**，Firefox 实机验证通过 |
| F5 | 操作日志：记录时间、URL、命中规则、动作、结果 / 错误 | 开发期辅助 | **不做独立日志页**。`explain()` 的 steps 已在控制台输出，足够排查「为什么没进组」；内存环形缓冲保留供调试 |
| F6 | 标签页名规则：每个分组可配置多条命名规则（源文本 / 目标文本 / 描述），按顺序匹配、命中第一条即停止；支持捕获组重排；配置页带多行测试区域，测试文本随配置保存 | P2 | **已完成（v0.5.0）** |
| F7 | 页面内标识：按分组在页面内绘制边框（上下左右可选、宽度可调、颜色取自分组）与 banner（上下左右为贴边小标签，宽度随文字、内侧圆角；四角为 45° 斜带，两端越过页面边缘并被裁掉，显示分组名；边框与 banner 的不透明度分别可调，默认 100% / 60%；配置页带一个示意预览框） | P1 | **已完成（v0.4.0）**，Firefox 实机验证通过 |

**验收标准（F1）**：打开 3 个 `localhost` 页面，自动进入同一「开发」组、绿色，控制台各打印一条命中记录。

## 规则怎么写

配置页左侧是分组列表，选中某个分组后在右侧编辑；一条规则对应一个分组，等价的结构（`schemaVersion: 5`）是：

```json
{
  "id": "code-github",
  "enabled": true,
  "name": "代码",
  "color": "blue",
  "collapsed": false,
  "minTabs": 3,
  "note": "代码托管：攒够 3 个再归组",
  "patterns": ["*://*.github.com/*", "*://gitlab.com/*"],
  "highlight": {
    "enabled": true,
    "border": { "sides": ["top", "bottom"], "width": 6, "opacity": 100 },
    "banner": { "positions": ["topRight", "bottomLeft"], "size": 34, "fontSize": 15, "opacity": 60 }
  },
  "titleRule": {
    "enabled": true,
    "rules": [
      {
        "pattern": "^\\[工作\\]\\s*(.*)$",
        "replacement": "W· $1",
        "description": "Jira / 工作"
      },
      {
        "pattern": "^(.*) - (.*)$",
        "replacement": "$2 · $1",
        "description": "通用「标题 - 站点」重排"
      }
    ],
    "testText": "[工作] Jira - 看板\nJira - GitHub"
  }
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
- `minTabs` 是**分组阈值**，默认 `1`（命中即归组）。设为 N 时，只有同一窗口内命中该规则的标签页数量 ≥ N 才归组；未达阈值会继续尝试后面的规则。计数按规则整体统计（一条规则覆盖多个站点时一起算），**不按域名分别计数**。
- 阈值达成时会**一起归组**：同窗口内命中该规则、且尚未归入任何分组的标签会被一并移入目标组。已经在别的分组里的标签不会被拽出来。
- 一个标签页最多命中一条规则。
- `titleRule` 是**标签页名规则**，可以配置多条命名规则：每条有「源文本（正则）」「目标文本（替换串）」「描述」三个字段；匹配按数组顺序进行，**命中第一条就停止**，后续不再匹配。替换只应用第一个匹配，目标文本支持 `$1`/`$<name>`/`$&`/`$$`，需要加前缀直接写进目标文本（例如 `W· $1`）。`testText` 保存多行测试文本（每行一个标题），配置页的测试区会逐行显示处理结果。
- `color` 取值：`grey` `blue` `red` `yellow` `green` `pink` `purple` `cyan` `orange`。

## 数据模型

配置存放在 `tabpilot:config`，`schemaVersion` 为 `5`：

```json
{
  "schemaVersion": 5,
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
      "patterns": ["*://localhost:*/*"],
      "highlight": {
        "enabled": false,
        "border": { "sides": ["top", "right", "bottom", "left"], "width": 4, "opacity": 100 },
        "banner": { "positions": ["topLeft"], "size": 28, "fontSize": 14, "opacity": 60 }
      },
      "titleRule": { "enabled": false, "rules": [], "testText": "" }
    }
  ]
}
```

- 未存过配置或配置校验失败时，插件回退到内置默认配置（即上面这条 `dev-localhost`）。
- **迁移链**：`v1 → v2`（`match.urlPattern` + `actions[]` + `priority` → `patterns` / 规则内联属性 / 数组顺序）→ `v3`（补 `highlight`）→ `v4`（补 `titleRule`）→ `v5`（`titleRule` 从单条正则升级为规则数组 + `testText`）。读取时自动迁移并写回，用户不需要手动处理。
- `schemaVersion` 是**配置格式版本**，只在结构不兼容变更时递增，与插件版本号无关。

## 架构与目录

```
manifest.json          MV3，background.scripts（非 service worker）+ content_scripts
src/
  background.js        事件监听 + 防抖调度：唯一做编排的地方；也负责回答页面标识查询
  rules.js             纯函数规则引擎：match / explain，可脱离浏览器单测
  actions.js           动作执行：唯一调用 tabs.group / tabGroups.* 的层
  store.js             存储封装：storage.local 读写 + schema 校验 + 迁移 + 默认配置
  highlight.js         页面内标识规格：默认值、边界收敛（background / content / 配置页共用）
  title-rule.js        标签页名规则：正则编译与替换（background / content / 配置页共用）
  content.js           content script：按 background 下发的规格绘制边框与 banner、改写页面标题
  logger.js            日志：控制台 + 内存环形缓冲（定位为开发调试辅助，不做独立日志页）
  options.html         配置页：两栏布局（左分组列表 / 右分组详情）
  options.js           配置页逻辑（选中、排序、删除、路径编辑与补全、页面内标识、校验提示、保存后请求同步）
test/
  rules.test.js        规则匹配、顺序优先级、阈值、窗口隔离、路径补全
  store.test.js        配置校验（含 minTabs / 颜色 / highlight / titleRule）与 v1→v5 迁移
  highlight.test.js    页面内标识规格的默认值、边界收敛、过滤去重
  title-rule.test.js   命名规则：顺序匹配、捕获组重排、非法正则、多行批处理、prefix 兼容
  background.test.js   编排链路：事件、同步、工具栏、消息、页面标识、调试入口
docs/PRD.md            需求、场景、架构、版本规划的完整依据
```

分层意图：规则引擎与 `browser.*` 解耦（只吃 tab / rules / context），存储层可整体替换，动作为唯一直接碰浏览器分组 API 的地方。以后换 IndexedDB、加 Chrome 兼容层都只改一层。

## 版本规划

| 版本 | 内容 | 状态 |
|---|---|---|
| v0.1.0 | 规则引擎 + 内置默认 `localhost` →「开发」组绿色 + 控制台日志 + 全量同步（工具栏按钮） | 已完成，Firefox 实机验证通过 |
| v0.2.0 | 配置页两栏布局：左栏只读分组列表（选中、⋯ 排序/删除），右栏编辑分组名/颜色/启停 + 多匹配路径（含自动补全）、阈值、折叠、备注；全局开关 + 保存前校验 + 保存后自动同步；配置结构升级到 `schemaVersion 2` 并自动迁移旧配置 | 已完成，Firefox 实机验证通过 |
| v0.3.0 | 配置导入 / 导出：工具栏「导出 JSON」「导入 JSON…」，导入校验（v1 自动迁移）、覆盖确认、导入后自动同步 | 已完成，Firefox 实机验证通过 |
| v0.4.0 | 页面内标识：按分组绘制边框（上下左右可选、宽度可调、颜色取自分组）与 banner（上下左右 + 四角斜向、显示分组名、尺寸/字号可调）；配置结构升级到 `schemaVersion 3` 并自动迁移 | 已完成，Firefox 实机验证通过 |
| v0.5.0 | 标签页名规则：每个分组可配置多条命名规则（源文本正则 / 目标文本 / 描述），按顺序匹配、命中第一条即停止；配置页提供多行测试并保存测试文本；配置结构升级到 `schemaVersion 5` 并自动迁移 | 已完成 |
| v0.6.0 | 按容器 / 窗口区分规则 | 规划中 |
| v1.0.0 | 稳定自用一周，卸载至少一个旧插件 | 规划中 |
| v1.1.0+ | 页面内标识的更多样式（位置/动画）；标题规则支持正则标志位 | 规划中 |

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

- **左栏：分组列表（只读）**。每行只有色块、分组名、iOS 风格拨杆（表示启用状态，不可点击）和 ⋯；点行选中分组，选中项左侧有高亮条，停用的分组名字带删除线。⋯ 菜单可上移 / 下移（**顺序即优先级，靠上的先匹配**）或删除。新建分组会按序号在 9 个预设色里循环取色，相邻分组默认不同色。
- **右栏：选中分组的详情**，分成三个可独立折叠的区块（折叠状态记在 localStorage）。默认只展开「基础配置」；折叠时标题右侧会显示该区块的状态——两个功能区块都用只读拨杆表示启停：
  - **基础配置**：分组名 / 颜色 / 阈值 / 启用 / 命中后折叠排在同一行（颜色是自带色块的自绘下拉，后两个是 iOS 拨杆，都是文字在上、控件在下）；下面依次是备注（可拖动缩放的文本域）与匹配路径（可增删、支持简写自动补全）。
  - **页面内突出显示**：一个开关；边框可勾选上/下/左/右并调整宽度与不透明度（颜色自动取该分组的颜色，默认不透明）；banner 可选上/下/左/右（贴着对应边缘的小标签，宽度随文字、内侧圆角）与四个角（45° 斜带，两端伸出页面边缘被裁掉），可调尺寸、字号与不透明度（默认 60%）。顶部有一个 **16:9 的示意预览框**：用细条和斜线表示位置、颜色与透明度，banner 内用 `XXX` 占位。新分组的默认值是**四边边框 + 左上角 banner**（标识总开关默认仍是关闭）。
  - **标签页名规则**：一个启用开关 + 一组命名规则卡片。每条规则有「描述、源文本（正则）、目标文本（可用 `$1`/`$2` 引用匹配组，需要加前缀就写在这里）」三个字段，卡片右上角可 ↑ / ↓ 调整顺序、✕ 删除；下方「＋ 添加命名规则」新增。底部是**测试区域**：每行一个标题，点「查看效果」逐行显示替换结果（未匹配的标黄提示）。测试文本会随配置一起保存，下次打开仍在。**未启用标题规则时整块置灰、不可编辑**，避免配了半天不生效。

顶部工具栏是全局开关与 `保存并同步` / `放弃修改` / `恢复默认` / `导出 JSON` / `导入 JSON…`。**操作结果提示显示在标题行**（插件名与版本号后面），成功 / 警告 / 失败用颜色区分；保存失败时错误会逐条列在标题行里（如 `rules[0].name 必须是非空字符串`），同时高亮左侧对应分组。保存成功会写回 storage 并立刻同步已打开的标签页；`Ctrl/Cmd + S` 也能保存。

### 导入 / 导出（v0.3.0）

入口在顶部工具栏：

| 按钮 | 行为 |
|---|---|
| 导出 JSON | 下载 `tabpilot-config-YYYYMMDD.json`，内容为当前编辑状态（含未保存的修改） |
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
    id: r.id, enabled: r.enabled, name: r.name,
    patterns: (r.patterns || []).join(' | '),
    minTabs: r.minTabs ?? 1,
    highlight: r.highlight ? r.highlight.enabled : false
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
- **页面内标识需要 content script 注入所有 http(s) 页面**，所以安装时 Firefox 会提示「可访问所有网站的数据」。扩展只用当前网址做规则匹配，仅在命中分组且该分组开启标识时绘制覆盖层：不读取页面内容、不上传任何数据。这是页面内标识的必要前提，已确认接受该权限。
- 页面内标识是 `position: fixed` 的覆盖层，`pointer-events: none`，不拦截点击；少数强制改写 `z-index` 或使用顶层 iframe 的页面可能遮不住，属已知限制。
- **标签页名规则靠 content script 改 `document.title`**：只要分组开启了标题规则就持续监听标题变化——即使打开页面时标题还不匹配，也会等页面把标题改成最终值后再应用；之后每次改名（含单页应用路由切换）都会重新匹配。另有每 1.5s 的低频兜底检查，防止页面用 observer 抓不到的方式改名。规则只在当前页面标题上生效，浏览器重启后重开页面会自动恢复。
- 命名规则**不支持正则标志位**（固定区分大小写、只替换第一个匹配）；需要忽略大小写时可以用字符类写法，例如 `[Jj]ira`。
- MV3 后台是事件页，会被回收：日志的内存缓冲、防抖队列都是易失状态。日志只作为开发期排查手段（控制台），不做落盘。
- 临时加载的扩展在**浏览器重启或重新载入后消失，storage 也随之清空**：用工具栏的「导出 JSON」备份，重载后用「导入 JSON…」恢复。
- 规则匹配不做容器（Container Tabs）区分，见 v0.6.0 规划。

## 许可证

[MIT](LICENSE)
