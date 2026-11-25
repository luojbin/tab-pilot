# TabPilot 开发指南

本文面向开发者和源码审核人员，说明架构、构建、测试、调试与发布流程。功能用法见 [README](README.md)，需求、范围和验收标准见 [PRD](docs/PRD.md)。

## 环境与快速开始

历史验证环境为 Windows、Node.js 24.14.0、npm 11.9.0；macOS 验证环境为 Node.js 26.7.0、npm 11.19.0，完整测试和双目标构建已通过。构建使用 Node API，不依赖 PowerShell 专用命令。目标浏览器为 Firefox 140+、Chrome / Edge（Chromium 116+），目标是桌面浏览器。

在仓库根目录或 GitHub 源码 ZIP 的解压目录执行：

```bash
npm ci
npm test
npm run build
npm run lint
```

`npm ci` 根据 `package-lock.json` 安装开发依赖，首次安装需要访问 npm 仓库。构建依赖 esbuild、archiver，Firefox 静态校验使用 web-ext。esbuild 包含平台相关可执行文件，安装和运行测试、构建时需要允许启动子进程；不要跨操作系统直接复用 `node_modules/`。

## 目录与职责

```text
src/
  core/
    rules.js           URL 匹配、优先级、阈值与 explain（纯函数）
    highlight.js       标识规格、颜色与布局计算（纯函数）
    config-migration.js schema 1 → 2 的无副作用迁移
    title-rule.js      标题正则编译、替换与批量测试（纯函数）
    manual-group-rule.js 网站默认模式、输入扩写与自动归组标记
    copy-rule.js       独立规则副本、唯一名称与默认停用
    append-rules.js    分组追加、名称/id 冲突处理
    reorder-rules.js   规则顺序移动
    rules-from-groups.js 当前窗口原生分组转规则草稿
    toolbar-feedback.js 中英文动作结果文案
    logger.js          控制台日志及内存环形缓冲
  app/
    store.js           配置校验、默认值与 storage.local 读写
    actions.js         tabs.group / tabGroups API 调用
    manual-group.js    外部归组检测、持久化待确认项与规则追加
    strict-mode.js     导航后复查组归属并移出不匹配标签
    tab-order.js       固定标签后整组前移
    toolbar-menu.js    Firefox 图标右键选项入口
    background.js      后台入口：事件、防抖、规则编排、消息和同步
    content.js         网页入口：边框、banner、标题改写与监听
  ui/
    options.html       配置页结构与样式
    options.js         配置页入口：编辑、预览、追加/替换导入、保存、窗口生成规则
    popup.html/js      图标动作结果与手动补规则确认表单
    rule-drag.js       列表拖动事件与插入位置指示
    i18n.js            配置页中英文案与语言解析（中文 / English）
  platform/
    browser.js         导出 globalThis.browser ?? globalThis.chrome
_locales/
  en/messages.json     manifest 英文名称 / 描述 / 工具栏标题
  zh_CN/messages.json  manifest 中文名称 / 描述 / 工具栏标题
manifests/
  base.json            共享 manifest 模板（名称与描述使用 __MSG_ 占位符）
  manifest.firefox.json Firefox 后台与专用声明
  manifest.chromium.json Chromium service worker 与最低版本
scripts/build-targets.mjs 构建、manifest 合并、静态资源复制与 ZIP 打包
test/                  单元测试与打包冒烟测试
icons/                 扩展图标
docs/PRD.md            产品需求与验收标准
dist/                  浏览器加载目录（不提交 Git）
output/                扩展 ZIP 等本地产物（不提交 Git）
```

规则引擎只接收 tab、规则和上下文，不直接调用浏览器 API。后台将匹配结果交给动作层执行；存储层负责配置读写与校验。配置格式的公开约定见 [PRD 数据模型](docs/PRD.md#5-数据模型)，当前为 `schemaVersion: 2`。

四个入口运行在独立环境：后台、配置页、popup、各网页的内容脚本。它们不共享模块状态；跨环境使用 `runtime.sendMessage` 和 `storage.onChanged` 通信。后台处理 `sync-all`、`page-style`、`toolbar-execute` 和 `manual-group-*` 消息，配置变化后向页面发送 `tabpilot:refresh`。设置页的从窗口生成规则直接读取浏览器 API，只写页面草稿，不借用图标动作。

## ES Module 与构建

源码使用 `import` / `export`，`package.json` 声明 `"type": "module"`。新增依赖直接在使用它的文件中导入，不需要在 manifest 或 HTML 中排列基础脚本顺序；仍需避免循环依赖和错误的异步初始化顺序。

配置页语言偏好是配置的一部分（`config.language`：`auto` / `zh` / `en`），随保存、导入导出一起迁移；manifest 的名称、描述和工具栏标题通过 `_locales/en`、`_locales/zh_CN` 与 `__MSG_*` 占位符由浏览器语言决定，不受配置页手动切换影响。

esbuild 将以下四个入口及其依赖分别打包为普通 IIFE 脚本：

- `src/app/background.js`
- `src/app/content.js`
- `src/ui/options.js`
- `src/ui/popup.js`

产物保留相同相对路径，不含运行时模块导入；manifest 的后台、内容脚本、配置页及 popup 各加载自己的单一入口。仅后台的 `globalThis.TabPilotDebug` 作为控制台调试接口保留，内部模块不挂到全局。

```bash
npm run build           # 同时构建两个目标
npm run build:firefox   # 仅 Firefox
npm run build:chromium  # 仅 Chromium
```

| 目标 | 加载目录 | ZIP |
|---|---|---|
| Firefox | `dist/firefox/` | `output/tabpilot-<version>-firefox.zip` |
| Chromium | `dist/chromium/` | `output/tabpilot-<version>-chromium.zip` |

构建前会清理对应目标的 `dist` 目录，再合并 manifest、注入 `package.json` 的版本、打包 JS、复制 HTML / 图标 / LICENSE / `_locales` 并生成 ZIP。只修改源码和模板，不直接编辑 `dist/`。当前不提供 watch 或 sourcemap，修改源码后需重新构建。

两个目标分别使用 `firefox140`、`chrome116` 作为语法兼容目标。当前版本的四个 JS 产物相同，差异在 manifest；以后使用新语法时，两个目标的 JS 输出可能不同。

### 浏览器适配

| 差异 | 实现 |
|---|---|
| API 命名空间 | 需要 API 的模块导入 `src/platform/browser.js`，不修改全局命名空间 |
| 后台 | Firefox 使用事件页 `background.scripts`；Chromium 使用 `background.service_worker`，都指向打包后的后台入口 |
| Manifest | Firefox 专用 ID、最低版本、数据收集声明和 `optional_host_permissions`（host 权限在 Firefox 可撤销）；Chromium 专用 `minimum_chrome_version`，其 content script 站点访问在安装时即为必需权限，故不声明 `optional_host_permissions` |
| 消息响应 | 后台使用 `sendResponse` + `return true` 异步回复 |
| 分组 API | 自动归组使用动作层；分组前置使用 tabGroups.move 整组移动，严格模式使用 tabs.ungroup；需实测成员、顺序、折叠和窗口隔离 |
| 图标右键选项 | Firefox 使用 menus 权限创建 action 上下文菜单；Chromium 使用 options_ui 提供的默认入口 |
| 自动打开 popup | 后台打开要求 Firefox 149+ / Chromium 127+；旧版或失败时显示角标，引导点击图标，不提升最低版本 |

后台打开 popup 的版本边界见 [Firefox 官方说明](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/) 和 [Chromium action.openPopup](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup)。这不影响用户直接点击图标打开 popup。

事件页和 service worker 都可能被回收。内存日志、tab 事件防抖队列和自动归组抑制标记不持久化；手动补规则的待确认项保存在 storage.local 的 `tabpilot:manual-group-requests`，不属于导出配置。不能将进程一直存活作为业务前提。标题改写通过 MutationObserver 监听，并使用 1.5 秒间隔检查兜底。

## 配置格式

正式 schema 1 和当前 schema 2 的字段约束及迁移关系见 [配置 JSON 格式参考](docs/schema-reference.md)。

配置保存在 `browser.storage.local` 的 `tabpilot:config`（见 `src/app/store.js`），导入 / 导出文件使用同一结构，当前为 `schemaVersion: 2`。一条规则对应一个标签页分组，`patterns` 里多个匹配路径任一命中即归组，数组顺序即优先级：

```json
{
  "schemaVersion": 2,
  "clickAction": "sync",
  "language": "auto",
  "autoUpdateGroupRules": true,
  "showActionResult": true,
  "groupsFirst": false,
  "rules": [
    {
      "id": "code-github",
      "enabled": true,
      "name": "代码",
      "color": "blue",
      "tabGroup": { "enabled": true, "minTabs": 3, "collapsed": false, "strictMode": false },
      "note": "代码托管：攒够 3 个再归组",
      "patterns": ["*://*.github.com/*", "*://gitlab.com/*"],
      "highlight": {
        "enabled": true,
        "border": { "sides": ["top", "bottom"], "width": 6, "opacity": 100 },
        "banner": { "positions": ["topRight"], "size": 34, "fontSize": 15, "opacity": 60 }
      },
      "titleRule": {
        "enabled": true,
        "rules": [
          { "titlePattern": "^\\[(.*?)\\]\\s*(.*)$", "urlPattern": "", "replacement": "W· ${title.2}", "description": "去掉前缀并加标记" }
        ],
        "testCases": [{ "title": "[工作] Jira - 看板", "url": "https://github.com/team/repo" }]
      }
    }
  ]
}
```

当前规则将浏览器群组设置收拢至 `tabGroup: { enabled, minTabs, collapsed, strictMode }`，默认开启群组、阈值 1、自动折叠和严格模式关闭。规则总开关控制整条规则；tabGroup.enabled 只控制原生群组操作。首条 URL 命中即确定归属，阈值不足不再落入后续规则。计数和批量候选仅包含同窗口首条归属本规则的标签，页面标识和重命名不受群组开关或阈值限制。

正式 schema 1 在读取及两种导入时直接迁移至 2；旧规则的 minTabs / collapsed / strictMode 移入 tabGroup，默认 enabled 为 true。schema 1 还会先迁移旧标题字段至双来源结构。旧 globalEnabled 忽略并移除，过渡全局严格模式补齐缺省的规则值。追加导入忽略全局设置；新导出使用 schema 2，不保证能导入旧插件。schema 2 以本节和当前源码为准。

字段含义、取值范围和校验规则见 [PRD 数据模型](docs/PRD.md#5-数据模型)；校验入口是 `src/app/store.js` 的 `validateConfig`。`schemaVersion` 只在配置结构不兼容变更时递增，与插件版本号解耦；`highlight` / `titleRule` 缺省时由配置页按默认值补齐。

## 测试与本地验证

`npm test` 使用 Node 测试运行器，测试文件默认在独立子进程执行：

| 测试 | 覆盖内容 |
|---|---|
| `rules.test.js` | URL、优先级、阈值、窗口隔离、路径补全 |
| `store.test.js` | 配置校验、默认值、导入导出数据 |
| `highlight.test.js` | 标识规格、边界和布局计算 |
| `validation-errors.test.js` | 结构化错误定位、旧路径回退、重名关联及实际设置页高亮回归 |
| `title-rule.test.js` | 双条件、双来源捕获组、旧模板迁移转换、非法正则、结构化测试 |
| `background.test.js` | 浏览器 mock 下的事件、同步、消息与配置处理 |
| `copy-rule.test.js` / `append-rules.test.js` | 深拷贝、追加导入、名称/id 冲突与数据保护 |
| `reorder-rules.test.js` / `rules-from-groups.test.js` | 拖动事件与顺序边界、当前窗口规则生成与去重 |
| `manual-group.test.js` | 待确认项持久化、自动归组排除、取消/过期/失败与开关 |
| `strict-mode.test.js` / `tab-order.test.js` | 导航归属、固定标签与窗口保护、整组移动及幂等 |
| `popup.test.js` / `toolbar-feedback.test.js` / `toolbar-menu.test.js` | popup 请求、计时、确认表单、结果提示与图标选项菜单 |
| `i18n.test.js` | 文案和模板翻译；不代表整页翻译覆盖 |
| `bundle.test.js` | 实际打包四个入口；在两种 API 命名空间下执行后台和内容脚本，验证归组与消息 |

当前完整测试为 **246 项通过**（含四项打包回归）。打包冒烟编译四入口并执行后台/内容脚本，只解析配置页和 popup 脚本；其他测试用桩验证部分 DOM/事件和 API 行为，未在真实浏览器中运行整页 UI。

受限环境可在单进程执行不依赖浏览器全局桩的 **160 项**：

```bash
node --test --test-isolation=none test/append-rules.test.js test/copy-rule.test.js test/highlight.test.js test/i18n.test.js test/reorder-rules.test.js test/rules-from-groups.test.js test/rules.test.js test/store.test.js test/strict-mode.test.js test/title-rule.test.js test/toolbar-feedback.test.js test/toolbar-menu.test.js test/validation-errors.test.js
```

`background`、`manual-group`、`popup`、`tab-order` 测试文件依赖各自的全局 API 桩，应使用 npm test 的独立进程，不要与上述文件在单进程混跑；bundle 测试另需 esbuild 子进程。部分逻辑测试通过不等于完整发布验证。

`npm run lint` 检查已构建的 `dist/firefox`，不检查 Chromium 包。当前 Firefox 校验有一条 Android 最低版本与数据收集声明的兼容警告；这不代表桌面扩展存在相同问题，Android 不在本项目支持范围内。

### 加载与调试

- Firefox：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `dist/firefox/manifest.json`；点击扩展的「检查」打开后台控制台。
- Chrome / Edge：`chrome://extensions` / `edge://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/chromium`；通过扩展的 service worker 检查入口打开后台控制台。
- 配置页在扩展选项中打开，页面标识与标题逻辑在目标网页的内容脚本上下文中调试。

重新构建后先重载扩展，再刷新目标网页；已有页面不会自动换成新的内容脚本。Firefox 临时扩展在浏览器重启后会被卸载，调试前建议导出配置备份。

### 手工验证清单

1. 基线功能：自动归组、优先级、阈值、窗口隔离、已分组保护、页面标识和 SPA 标题恢复。
2. 左栏：新增菜单、空白规则、复制默认值、拖拽前后插入、菜单排序、保留选中与草稿、保存/放弃。
3. 从当前窗口生成：排除其他窗口、同名规则跳过、原生同名组合并、网站模式和端口、过滤受限页、重复生成。
4. 全局卡片：五张全局卡片两列排列，中英文及暗色模式；旧全局开关移除，三个全局功能开关及组内严格模式保存和导入导出行为正确。
5. 分组前置：自动新建/归组、阈值批量、手动归属变化和严格模式移出后及时前置；整组移动不改成员、相对顺序、折叠组、重复执行、多窗口及错误隔离。
6. 自动折叠：新建组/外部入组后折叠，组内前后台导航保持状态，阈值批处理只折叠一次，关闭选项不展开，失败不折叠；显式折叠照常执行。
7. 图标 popup：四种快捷动作、结果开关、3 秒停留与淡出、设置入口取消计时、受限页使用；Firefox 图标右键选项。
8. 拖入补规则：对应/无对应规则组、自动归组不询问、地址编辑扩写、重复项、取消、失效与保存失败、关闭开关清除角标；低版本 popup 打开失败后的角标入口。
9. 组内严格模式：独立启停、旧全局值迁移与显式组内值优先；协议/端口/路径/重定向/SPA 导航、已停用规则和纯手动组、固定标签、过期导航事件，以及与拖入询问组合使用。
10. JSON：替换导入、追加导入忽略文件全局设置、名称/id 连续冲突、空文件、非法数据、取消、当前未保存修改处理。
11. Firefox / Chrome / Edge 分别记录浏览器版本和结果，重启后验证配置及后台唤醒。已确认的阶段性结果和最终集成待办见 [开发计划](docs/development-plan.md#验证状态)。

## 后台控制台调试

以下接口只能在扩展后台控制台使用：

| 命令 | 行为 |
|---|---|
| `await TabPilotDebug.getConfig()` | 返回 `{ config, source, errors? }` |
| `await TabPilotDebug.addRule(rule)` | 按 ID 替换或追加规则，并保存同步；替换的规则移到末尾 |
| `await TabPilotDebug.removeRule(id)` | 删除规则，并保存同步 |
| `await TabPilotDebug.setConfig(config)` | 校验后整份替换配置，并同步 |
| `await TabPilotDebug.resetConfig()` | 清除存储配置、恢复默认并同步 |
| `await TabPilotDebug.syncAll()` | 同步已打开标签，返回统计；会执行分组动作 |
| `await TabPilotDebug.openOptions()` | 打开配置页 |

存储没有配置或配置校验失败时使用默认规则。有效的自定义配置不会自动合并默认规则；整份替换时要自行保留需要的规则。

### 排查为什么没有归组

先检查配置和标签状态，下面的操作只读取信息：

```js
(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  const { config, source, errors } = await TabPilotDebug.getConfig();
  console.log('配置来源:', source, '校验错误:', errors ?? '无');
  console.table(config.rules.map(r => ({
    id: r.id, enabled: r.enabled, name: r.name,
    patterns: r.patterns.join(' | '), tabGroup: r.tabGroup,
    highlight: r.highlight?.enabled ?? false,
    titleRule: r.titleRule?.enabled ?? false
  })));
  const tabs = await api.tabs.query({});
  console.table(tabs.map(t => ({
    id: t.id, windowId: t.windowId, groupId: t.groupId, url: t.url
  })));
})();
```

如果要补同步，可执行 `await TabPilotDebug.syncAll()`，它默认跳过已分组标签并打印汇总统计。需要查看逐标签判定时，刷新未分组的目标标签并观察后台事件日志：`steps` 说明 URL 归属和群组阈值判断，命中后的 `results` 说明分组动作是否成功。计数按同一窗口、同一规则统计。

`TabPilotStore`、`TabPilotRules` 等内部对象已不再暴露到全局，不能在控制台直接调用。需要单步检查纯规则引擎时，在源码和测试中使用模块导入。

页面没有边框或标题变化时，先检查扩展错误列表。`Invalid or unexpected token` 表示脚本在解析阶段失败，应从源码重新构建，重载扩展并刷新网页。不要直接修补 bundle。内容脚本正常执行后，可检查网页根元素的 `data-tabpilot`：`loaded`、`on`、`title`、`off` 分别表示已加载待查询、标识开启、仅标题规则、未启用效果。

## 发布与 Mozilla 源码审核

现有商店条目：[Firefox AMO](https://addons.mozilla.org/zh-CN/firefox/addon/tabpilot-firefox/)、[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tabpilot/cdjpnbjccmeddhagmbbgjcckjfnofbbn)。已确认 Firefox 和 Edge 均已上架 1.2.0；各渠道版本和 1.3.0 提交状态分别记录在 [开发计划](docs/development-plan.md#已登记发布渠道)。

版本号只在 `package.json` 中维护，由构建脚本注入 manifest。manifest、配置页与 ZIP 文件名均使用 package.json 中的同一个数字版本，不添加预发布后缀或 version_name。配置格式版本 `schemaVersion` 独立维护，不能随插件版本机械递增。

本项目以用户可见功能和配置兼容性作为版本判断依据：兼容的维护修复和不改变行为的内部重构使用补丁版本，新增兼容功能使用次版本，不兼容变更使用主版本。当前开发版本从已发布的 `1.2.0` 推进到 `1.3.0`，包含新增功能和全局启停移除；schemaVersion 升级为 2，旧配置读取兼容与回退限制见上文。当前源码通过检查不代表已提交商店。修改版本号时同步更新 `package-lock.json` 的根版本及根包版本。

1. 更新版本号和发布说明，运行测试、双目标构建、Firefox lint，并完成本次改动相关的浏览器验证。提交全部发布代码，创建并推送版本 tag（如 `v1.3.0`）；同一已上传的 Mozilla 版本号不能重复使用。
2. 从该 tag 的干净源码执行 `npm ci`、`npm run build`，将 Firefox 和 Chromium ZIP 上传到对应 GitHub Release。普通 Release 在等待 Firefox 签名时不设为 Latest，可选择 `None` 并注明「Firefox 签名处理中」。测试版本使用 Pre-release。
3. 下载该 Release 自动提供的 **Source code (zip)**。向 Mozilla 提交 Firefox 构建 ZIP，并将该源码 ZIP 上传到源码附件字段；不能只提交源码 ZIP 代替可安装扩展。根据分发需求选择 AMO 上架（listed）或自行分发（unlisted）。
4. 获取 Mozilla 签名后的 `.xpi`，补传到同一 Release；确认安装可用后标记为 Latest。如果启用了不可变 Release，先创建 tag 并下载该 tag 的源码归档，Release 保持草稿，补齐附件后再正式发布。
5. Chromium ZIP 可用于 Chrome Web Store / Edge Add-ons 提交；本地开发仍加载 `dist/chromium`。Firefox ZIP 未签名时仅用于临时加载和送审，正式安装使用签名 XPI。

不自行构建源码 ZIP。GitHub 自动源码包是对应 tag 的仓库文件快照，包含受版本管理的测试和文档，不含 Git 历史或未提交修改。送审扩展必须由这个 tag 构建；不能将本地未提交改动混入送审产物。

### 审核人员重新构建

将 GitHub Source code ZIP 解压到空目录，进入包含 `package.json` 的目录，使用上述 Node/npm 环境执行：

```bash
npm ci
npm run build:firefox
```

生成目录为 `dist/firefox/`，ZIP 为 `output/tabpilot-<version>-firefox.zip`。如需验证，可继续执行 `npm test` 和 `npm run lint`。重建时比对未签名扩展文件的内容；签名后的 XPI 额外含 Mozilla 签名信息。

提交时注明实际操作系统、Node/npm 版本及构建命令。构建指南与官方流程分别见 [Mozilla 源码提交](https://www.extensionworkshop.com/documentation/publish/source-code-submission/)、[Mozilla 签名与分发](https://www.extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)、[GitHub Release 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## 修改时同步维护什么

- 改变用户可见行为时，更新 README 的用法及 PRD 的需求或验收标准。
- 改变架构、命令、调试接口或发布步骤时，更新本指南。
- 新增或修改逻辑时，按影响运行相关测试；修改配置页 DOM 交互后进行手工验证。
- 新增依赖时同步提交 `package.json`、`package-lock.json`。修改源码后重新构建，不提交 `node_modules/`、`dist/` 或 `output/`。

配置校验失败保留 `errors: string[]` 作为展示文案，并返回 `errorDetails` 的规则组索引、相关规则组及命名规则字段路径。设置页优先使用结构化位置高亮，避免把内层命名规则索引当作外层规则组号。
