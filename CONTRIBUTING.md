# TabPilot 开发指南

本文面向开发者和源码审核人员，说明架构、构建、测试、调试与发布流程。功能用法见 [README](README.md)，需求、范围和验收标准见 [PRD](docs/PRD.md)。

## 环境与快速开始

当前验证环境为 Windows、Node.js 24.14.0、npm 11.9.0。构建使用 Node API，不依赖 PowerShell 专用命令；其他操作系统需要单独验证。目标浏览器为 Firefox 140+、Chrome / Edge（Chromium 116+），目标是桌面浏览器。

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
    title-rule.js      标题正则编译、替换与批量测试（纯函数）
    logger.js          控制台日志及内存环形缓冲
  app/
    store.js           配置校验、默认值与 storage.local 读写
    actions.js         tabs.group / tabGroups API 调用
    background.js      后台入口：事件、防抖、规则编排、消息和同步
    content.js         网页入口：边框、banner、标题改写与监听
  ui/
    options.html       配置页结构与样式
    options.js         配置页入口：编辑、预览、导入导出与保存
  platform/
    browser.js         导出 globalThis.browser ?? globalThis.chrome
manifests/
  base.json            共享 manifest 模板
  manifest.firefox.json Firefox 后台与专用声明
  manifest.chromium.json Chromium service worker 与最低版本
scripts/build-targets.mjs 构建、manifest 合并、静态资源复制与 ZIP 打包
test/                  单元测试与打包冒烟测试
icons/                 扩展图标
docs/PRD.md            产品需求与验收标准
dist/                  浏览器加载目录（不提交 Git）
output/                扩展 ZIP 等本地产物（不提交 Git）
```

规则引擎只接收 tab、规则和上下文，不直接调用浏览器 API。后台将匹配结果交给动作层执行；存储层负责配置读写与校验。配置格式的公开约定见 [PRD 数据模型](docs/PRD.md#5-数据模型)，基线为 `schemaVersion: 1`。

三个入口运行在独立环境：后台、配置页、各网页的内容脚本。它们不共享模块状态；跨环境使用 `runtime.sendMessage` 和 `storage.onChanged` 通信。后台处理 `sync-all`、`page-style` 消息，配置变化后向页面发送 `tabpilot:refresh`。

## ES Module 与构建

源码使用 `import` / `export`，`package.json` 声明 `"type": "module"`。新增依赖直接在使用它的文件中导入，不需要在 manifest 或 HTML 中排列基础脚本顺序；仍需避免循环依赖和错误的异步初始化顺序。

esbuild 将以下三个入口及其依赖分别打包为普通 IIFE 脚本：

- `src/app/background.js`
- `src/app/content.js`
- `src/ui/options.js`

产物保留相同相对路径，不含运行时模块导入；manifest 的后台、内容脚本及配置页各加载自己的单一入口。仅后台的 `globalThis.TabPilotDebug` 作为控制台调试接口保留，内部模块不挂到全局。

```bash
npm run build           # 同时构建两个目标
npm run build:firefox   # 仅 Firefox
npm run build:chromium  # 仅 Chromium
```

| 目标 | 加载目录 | ZIP |
|---|---|---|
| Firefox | `dist/firefox/` | `output/tabpilot-<version>-firefox.zip` |
| Chromium | `dist/chromium/` | `output/tabpilot-<version>-chromium.zip` |

构建前会清理对应目标的 `dist` 目录，再合并 manifest、注入 `package.json` 的版本、打包 JS、复制 HTML / 图标 / LICENSE 并生成 ZIP。只修改源码和模板，不直接编辑 `dist/`。当前不提供 watch 或 sourcemap，修改源码后需重新构建。

两个目标分别使用 `firefox140`、`chrome116` 作为语法兼容目标。当前版本的三个 JS 产物相同，差异在 manifest；以后使用新语法时，两个目标的 JS 输出可能不同。

### 浏览器适配

| 差异 | 实现 |
|---|---|
| API 命名空间 | 需要 API 的模块导入 `src/platform/browser.js`，不修改全局命名空间 |
| 后台 | Firefox 使用事件页 `background.scripts`；Chromium 使用 `background.service_worker`，都指向打包后的后台入口 |
| Manifest | Firefox 专用 ID、最低版本和数据收集声明；Chromium 专用 `minimum_chrome_version`；内容脚本和权限共享 |
| 消息响应 | 后台使用 `sendResponse` + `return true` 异步回复 |
| 分组 API | 共用动作层；真实浏览器仍需验证折叠、窗口隔离及已分组标签行为 |

事件页和 service worker 都可能被回收。内存日志及待处理队列不持久化，不能将进程一直存活作为业务前提。标题改写通过 MutationObserver 监听，并使用 1.5 秒间隔检查兜底。

## 测试与本地验证

`npm test` 使用 Node 测试运行器，测试文件默认在独立子进程执行：

| 测试 | 覆盖内容 |
|---|---|
| `rules.test.js` | URL、优先级、阈值、窗口隔离、路径补全 |
| `store.test.js` | 配置校验、默认值、导入导出数据 |
| `highlight.test.js` | 标识规格、边界和布局计算 |
| `title-rule.test.js` | 首条命中、捕获组、非法正则、多行测试 |
| `background.test.js` | 浏览器 mock 下的事件、同步、消息与配置处理 |
| `bundle.test.js` | 实际打包三个入口；在两种 API 命名空间下执行后台和内容脚本，验证归组与消息 |

打包冒烟测试只编译、解析配置页脚本，未执行配置页 DOM 交互。浏览器 API mock 不能替代真实浏览器验证。

`npm run lint` 检查已构建的 `dist/firefox`，不检查 Chromium 包。当前 Firefox 校验有一条 Android 最低版本与数据收集声明的兼容警告；这不代表桌面扩展存在相同问题，Android 不在本项目支持范围内。

### 加载与调试

- Firefox：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `dist/firefox/manifest.json`；点击扩展的「检查」打开后台控制台。
- Chrome / Edge：`chrome://extensions` / `edge://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/chromium`；通过扩展的 service worker 检查入口打开后台控制台。
- 配置页在扩展选项中打开，页面标识与标题逻辑在目标网页的内容脚本上下文中调试。

重新构建后先重载扩展，再刷新目标网页；已有页面不会自动换成新的内容脚本。Firefox 临时扩展在浏览器重启后会被卸载，调试前建议导出配置备份。

### 手工验证清单

1. 打开多个带端口的 `localhost` 页面，确认默认「开发」规则归组及颜色。
2. 新增规则，验证保存同步、优先级、阈值、跨窗口隔离、全局和单条启停；确认不抢走已分组标签。
3. 开启边框和 banner，检查位置、颜色、透明度及保存后的更新。
4. 开启标题规则，验证多条规则优先级、捕获组、SPA 修改标题，以及关闭规则后恢复原标题。
5. 验证配置页增删排序、预览、折叠、多行标题测试、JSON 导入导出及非法配置提示。
6. 在 Firefox 和实际使用的 Chrome / Edge 中分别执行；浏览器重启后再检查配置及后台唤醒行为。

用户已确认 Chromium 页面边框和 banner 在修复产物语法错误后正常；这仅代表该场景通过，不等同于完整跨浏览器清单或商店审核通过。

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
  console.log('配置来源:', source, '全局启用:', config.globalEnabled, '校验错误:', errors ?? '无');
  console.table(config.rules.map(r => ({
    id: r.id, enabled: r.enabled, name: r.name,
    patterns: r.patterns.join(' | '), minTabs: r.minTabs ?? 1,
    highlight: r.highlight?.enabled ?? false,
    titleRule: r.titleRule?.enabled ?? false
  })));
  const tabs = await api.tabs.query({});
  console.table(tabs.map(t => ({
    id: t.id, windowId: t.windowId, groupId: t.groupId, url: t.url
  })));
})();
```

如果要补同步，可执行 `await TabPilotDebug.syncAll()`，它默认跳过已分组标签并打印汇总统计。需要查看逐标签判定时，刷新未分组的目标标签并观察后台事件日志：未命中的 `steps` 说明路径或阈值原因，命中后的 `results` 说明分组动作是否成功。计数按同一窗口、同一规则统计。

`TabPilotStore`、`TabPilotRules` 等内部对象已不再暴露到全局，不能在控制台直接调用。需要单步检查纯规则引擎时，在源码和测试中使用模块导入。

页面没有边框或标题变化时，先检查扩展错误列表。`Invalid or unexpected token` 表示脚本在解析阶段失败，应从源码重新构建，重载扩展并刷新网页。不要直接修补 bundle。内容脚本正常执行后，可检查网页根元素的 `data-tabpilot`：`loaded`、`on`、`title`、`off` 分别表示已加载待查询、标识开启、仅标题规则、未启用效果。

## 发布与 Mozilla 源码审核

版本号只在 `package.json` 中维护，由构建脚本注入 manifest。配置格式版本 `schemaVersion` 独立维护，不能随插件版本机械递增。

本项目以用户可见功能和配置兼容性作为版本判断依据：兼容的维护修复和不改变行为的内部重构使用补丁版本，新增兼容功能使用次版本，不兼容变更使用主版本。本次从已发布的 `1.1.0` 升到 `1.1.1`，不新增功能、不改变配置格式；已发布 tag 保持不变。修改版本号时同步更新 `package-lock.json` 的根版本及根包版本。

1. 更新版本号和发布说明，运行测试、双目标构建、Firefox lint，并完成本次改动相关的浏览器验证。提交全部发布代码，创建并推送版本 tag（如 `v1.1.1`）；同一已上传的 Mozilla 版本号不能重复使用。
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
