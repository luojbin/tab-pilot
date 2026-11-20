# AGENTS.md

本文件给在 TabPilot 仓库里工作的 AI / 自动化代理使用。DSH 会读取仓库根目录的 `AGENTS.md`，作为本项目的默认工作约定。

## 项目速览

- 浏览器扩展，WebExtensions MV3，共享源码同时构建 Firefox / Chromium。
- 源码是 ES Module，构建用 esbuild 打成四个 IIFE 入口：
  - `src/app/background.js`
  - `src/app/content.js`
  - `src/ui/options.js`
  - `src/ui/popup.js`
- manifest 模板在 `manifests/`，构建时合并并注入 `package.json` 的版本。
- 浏览器加载的是 `dist/firefox` / `dist/chromium`，不是 `src/`；改源码后必须重新构建。
- 配置页支持中文 / English，文案在 `src/ui/i18n.js`，manifest 文案在 `_locales/`。

## 先确认环境

在仓库根目录执行：

```powershell
pwd
node -v
npm -v
npm config get cache
Test-Path node_modules
```

当前开发环境通常是 Node 24 + npm 11。`npm config get cache` 可能指向类似：

```text
D:\Repository\nodejs\node_cache
```

这个目录在 DSH 会话工作区之外，`workspace-write` 权限下 npm 写缓存会失败，见下一节。

## DSH 受限会话下的 npm

### 症状

```text
npm error code EPERM
npm error syscall open
npm error path ...\_cacache\tmp\...
```

这是**缓存目录不在工作区**导致的，不是 npm 或代码问题。

### 处理

把 npm 缓存放到工作区内（`output/` 已被 Git 忽略）：

```powershell
$env:npm_config_cache = Join-Path (Get-Location) 'output\.npm-cache'
npm ci
```

如果 `node_modules` 已经存在，可以只跑测试 / 构建，不必重复安装。

### 症状：spawn EPERM

```text
Error: spawn EPERM
```

DSH 受限沙箱禁止 Node 以管道方式 spawn 子进程。以下命令会因此失败：

- `npm test`（Node 测试运行器按文件 spawn 子进程）
- `npm run build`（esbuild 启动子进程）
- `test/bundle.test.js`（内部调用 esbuild）

这是环境限制，**不是代码缺陷**。不要在同一个受限会话里反复重试，换一个允许进程 spawn 的环境。

## 测试

### 纯逻辑测试（受限会话可跑）

使用 `--test-isolation=none` 让测试在同一进程里执行，绕过 spawn。测试文件按目录通配，新增的纯逻辑测试会自动纳入，排除需要 esbuild 子进程的 bundle 测试，以及依赖独立浏览器全局桩的 background / manual-group / popup / tab-order 测试：

```powershell
node --test --test-isolation=none `
  (Get-ChildItem test\*.test.js -Exclude bundle.test.js,background.test.js,manual-group.test.js,popup.test.js,tab-order.test.js).FullName
```

当前该子集为 **127 项通过**。其余浏览器 API 桩测试需要独立测试进程，不能在同一进程混跑。macOS / Linux 的等效命令见 CONTRIBUTING.md。

### 完整测试（需要完整权限）

```powershell
$env:npm_config_cache = Join-Path (Get-Location) 'output\.npm-cache'
npm test
```

完整测试为 **193 项**：127 项单进程子集、64 项独立浏览器桩测试，以及 `test/bundle.test.js` 的 2 项打包冒烟测试。完整测试和 esbuild 打包均要求允许启动子进程。

### 不要做的事

- 不要因为 `spawn EPERM` 删除或跳过 `test/bundle.test.js`；它是打包产物回归测试。
- 不要把受限沙箱里“部分测试通过”当成发布验证完成。

## 构建与 lint

需要完整进程权限：

```powershell
$env:npm_config_cache = Join-Path (Get-Location) 'output\.npm-cache'
npm run build
npm run lint
```

产物：

```text
dist/firefox/                       Firefox 加载目录
dist/chromium/                      Chrome / Edge 加载目录
output/tabpilot-<version>-firefox.zip
output/tabpilot-<version>-chromium.zip
```

- `npm run lint` 只检查 `dist/firefox`，必须在 build 之后跑。
- `dist/`、`output/` 不提交 Git；不要手工编辑产物。
- 版本号只在 `package.json` 维护；构建注入 manifest。改版本时同步 `package-lock.json` 根部 version。
- Edge / Chrome 商店不接受重复版本号；每次上传前递增 `package.json` 版本。

## 代码约定

- 分层：`core`（纯逻辑）/ `app`（浏览器 API）/ `ui`（配置页）/ `platform`（平台入口）。
- 不要新增全局变量；只有后台保留 `globalThis.TabPilotDebug` 作为控制台调试入口。
- 新增 UI 文案时，同时更新 `src/ui/i18n.js` 的中英文；用户数据（分组名、备注、匹配路径、测试文本）不得被翻译。
- manifest 名称 / 描述 / 工具栏标题使用 `_locales` 的 `__MSG_*__` 占位符；`_locales` 目录必须随构建复制到包根目录。
- Firefox 专用字段（`browser_specific_settings`、`data_collection_permissions`）不能进 Chromium manifest。
- 不允许远程代码；保持 `data_collection_permissions` 为 `["none"]`。
- 默认不要自动提交或推送 Git；等开发者明确要求提交后再操作。

## 发布检查

1. 完整环境执行 `npm ci`、`npm test`、`npm run build`、`npm run lint`。
2. Firefox：上传 `output/tabpilot-<version>-firefox.zip` 到 AMO，下载签名 xpi。
3. Chrome / Edge：同一个 `output/tabpilot-<version>-chromium.zip` 分别上传两个商店。
4. Edge Partner Center 会按 `_locales` 识别语言；补齐每种语言的 Description、logo、截图。
5. 记录实际使用的版本号、产物名、商店审核状态。
