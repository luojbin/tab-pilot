# TabPilot

<img src="icons/icon-128.png" width="96" height="96" alt="TabPilot 图标" align="right">

标签页管理器：按规则自动把页面归入分组、给分组上色，还能在页面内显示分组标识、按规则改写标签页标题。

- **适用**：Firefox 140+、Chrome / Edge（Chromium 116+）
- **依赖**：`tabGroups` API（各浏览器版本要求不同）
- **运行方式**：纯本地，无网络请求、不上传任何数据
- **配置**：全部在可视化配置页里完成，支持导入 / 导出 JSON

> 开发进度、架构、版本规划等开发文档见 [docs/PRD.md](docs/PRD.md)。

---

## 安装

### Firefox

**从 AMO 安装（上架后）**：在 [addons.mozilla.org](https://addons.mozilla.org/) 搜索 **TabPilot**，点「添加到 Firefox」。

**从文件安装已签名版本**：

1. 打开 `about:addons`
2. 右上角齿轮 → **从文件安装附加组件**
3. 选择签名后的 `.xpi`

> 正式版 Firefox 只允许安装已签名的扩展；未签名的 zip 只能在下面临时加载。

### Chrome / Edge

Chrome Web Store / Edge Add-ons 尚未上架。本地测试请先按下一节构建，再加载 `dist/chromium`。

### 从源码构建（开发 / 本地测试）

```bash
npm install
npm run build          # 同时构建 Firefox 与 Chromium
npm run build:firefox  # 或者只构建其中一个
npm run build:chromium
```

源码使用 ES Module（`import` / `export`），构建脚本通过 esbuild 将后台、网页内容脚本和配置页三个入口分别打包为独立的普通 JS 脚本。浏览器加载的是 `dist/` 中的产物；修改源码后需要重新构建并重载扩展。

新增依赖时在使用它的文件中直接 `import`，无需在 manifest 或 HTML 中维护基础脚本的加载顺序。`src/platform/browser.js` 统一提供 Firefox / Chromium 的浏览器 API；后台保留 `TabPilotDebug` 控制台调试入口。

| 目标 | 目录 | 压缩包 |
|---|---|---|
| Firefox | `dist/firefox/` | `output/tabpilot-<version>-firefox.zip` |
| Chrome / Edge | `dist/chromium/` | `output/tabpilot-<version>-chromium.zip` |

**Firefox 临时加载**：`about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `dist/firefox/manifest.json`。

**Chrome / Edge 加载**：打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ 打开「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `dist/chromium` 目录。

> Firefox 的临时加载在浏览器重启或重新载入后消失，配置也会清空；Chrome / Edge 的「加载已解压的扩展程序」会一直保留，直到手动移除。Firefox 重载前建议先用「导出 JSON」备份。

## 快速开始

1. 打开配置页：Firefox 是 `about:addons` → TabPilot → **首选项**；Chrome / Edge 是 `chrome://extensions` / `edge://extensions` → TabPilot → **详细信息** → **扩展选项**
2. 左栏默认已有一条「开发」规则（`localhost` → 绿色）。点「＋」新建分组，在右栏填：
   - **分组名**、**颜色**
   - **匹配路径**（可以只写域名，保存时自动补全）
3. 点顶部 **保存并同步**
4. 打开目标页面，标签页会自动进入对应分组

## 它能做什么

| 能力 | 说明 |
|---|---|
| 自动归组 | 按 URL 规则把新打开的标签页放进指定分组，并设置颜色、是否折叠 |
| 手动补同步 | 已经开着的标签页，保存配置或点工具栏按钮后按规则补处理一遍 |
| 页面内标识 | 命中分组的页面显示彩色边框和分组名 banner，快速认出「这是哪个环境」 |
| 标签页改名 | 用正则改写标签页标题，支持捕获组重排、加前缀，并可多行测试 |
| 备份恢复 | 导出 / 导入 JSON，换机器或重载扩展后快速恢复配置 |

## 规则与匹配

### 一条规则 = 一个分组

配置页左侧是分组列表，选中某个分组后在右侧编辑。一条规则对应的 JSON（导入 / 导出格式，`schemaVersion: 1`）示例：

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
    "banner": { "positions": ["topRight"], "size": 34, "fontSize": 15, "opacity": 60 }
  },
  "titleRule": {
    "enabled": true,
    "rules": [
      { "pattern": "^\\[(.*?)\\]\\s*(.*)$", "replacement": "W· $2", "description": "去掉前缀并加标记" }
    ],
    "testText": "[工作] Jira - 看板"
  }
}
```

### 匹配路径

`patterns` 是匹配路径列表，**任意一条命中即算命中**，同一个分组可以覆盖多个站点。

路径可以直接写简写，离开输入框或保存时会自动补全：

| 你写的 | 自动补成 | 说明 |
|---|---|---|
| `localhost` | `*://localhost:*/*` 和 `*://localhost/*` | 没有协议 → 同时匹配 http/https；没有路径 → 同时匹配任意端口与无端口 |
| `192.168.0.123` | `*://192.168.0.123:*/*` 和 `*://192.168.0.123/*` | 同上 |
| `localhost:3000` | `*://localhost:3000/*` | 已写端口，不再展开 |
| `https://example.com/foo` | `https://example.com/foo/*` | 结尾自动补 `/*` |
| `https://example.com/foo/*` | 不变 | 已经是完整模式 |

- 展开后只支持 `*` 通配，其余字符按字面量处理。
- `*.github.com` 同时匹配 `github.com` 与所有子域名；不带 `*.` 的 `github.com` 只匹配该主机本身。

### 顺序即优先级

分组列表的顺序就是匹配顺序，**靠上的先匹配**。一个标签页最多进入一个分组。用左栏的 ⋯ 菜单上移 / 下移调整。

### 阈值（`minTabs`）

默认 `1`，即命中就归组。设为 N 时：

- 只有**同一窗口内命中这条规则的标签页数量 ≥ N** 才归组，否则继续尝试后面的规则
- 计数按规则整体统计（一条规则覆盖多个站点时一起算），不按域名分别计数
- 达到阈值时，同窗口内命中该规则、且**还没进任何分组**的标签会被一起归组
- 已经在别的分组里的标签不会被拽出来

### 启用 / 停用

- 单条规则：右栏「启用」开关，或左栏列表里的状态
- 全局：配置页左上角「启用自动归组」，关掉后所有规则暂停

## 页面内标识

给分组开启后，命中该分组的页面会显示：

- **边框**：上 / 右 / 下 / 左任选，宽度 1–24px，颜色自动取分组颜色，可调不透明度
- **banner**：上 / 下 / 左 / 右四边（贴着边缘的小标签，宽度随文字、靠页内一侧圆角），以及四个角（45° 斜带，两端越过页面边缘被裁掉），显示分组名；尺寸 8–160px、字号 8–32px、不透明度可调
- 边框和 banner 的透明度**分别控制**：边框默认 100%（不透明），banner 默认 60%

配置页顶部有一个 **16:9 示意预览框**：用细条和斜线标出位置，banner 内用 `XXX` 占位，颜色与透明度跟随当前配置，方便调参。

> 新建分组的默认值是「四边边框 + 左上角 banner」，但标识总开关默认关闭——需要手动打开。

## 标签页名规则

每个分组可以配置一组**命名规则**，按顺序匹配当前标签页标题，**命中第一条就停止**：

| 字段 | 说明 |
|---|---|
| 描述 | 仅用于配置页展示 |
| 源文本（正则） | 匹配标题的正则表达式，只替换第一个匹配 |
| 目标文本 | 替换串，支持 `$1`/`$2` 捕获组、`$<name>` 命名组、`$&` 整个匹配、`$$` 字面量 `$`；需要加前缀直接写在这里 |

- 卡片右上角 ↑ / ↓ 调整顺序，✕ 删除；「＋ 添加命名规则」新增
- 底部**测试区域**：每行输入一个标题，点「查看效果」逐行显示替换结果；未匹配的行会标黄提示
- 测试文本会随配置保存，下次打开配置页仍在
- **总开关关闭时整块置灰、不可编辑**，避免配了却不生效
- 页面之后再次修改标题（含单页应用路由切换）会自动重新匹配；关闭规则或分组不再命中时恢复原标题

示例：`^\[工作\]\s*(.*)$` → `W· $1`，把 `[工作] Jira - 看板` 变成 `W· Jira - 看板`。

## 配置页说明

### 左栏：分组列表（只读）

每行有色块、分组名、状态拨杆和 ⋯ 菜单。点行选中，选中项左侧有高亮条，停用的分组名带删除线。⋯ 菜单可上移 / 下移 / 删除。新建分组会按序号在 9 个预设色里循环取色。

### 右栏：分组详情

三个可独立折叠的区块（折叠状态会记住）：

1. **基础配置**：分组名、颜色、阈值、启用、命中后折叠、备注、匹配路径
2. **页面内突出显示**：开关 + 边框 / banner 配置 + 示意预览
3. **标签页名规则**：开关 + 命名规则卡片 + 多行测试

折叠时标题右侧会显示该区块的状态（启停拨杆），不用展开就能看出有没有配置。

### 顶部工具栏

| 按钮 | 行为 |
|---|---|
| 启用自动归组 | 全局开关 |
| 保存并同步 | 校验后保存，并立即按规则处理已打开的标签页 |
| 放弃修改 | 重新从存储加载 |
| 恢复默认 | 删除存储的配置，回到内置默认规则 |
| 导出 JSON | 下载 `tabpilot-config-YYYYMMDD.json`（含未保存的修改） |
| 导入 JSON… | 校验通过后替换当前配置并同步 |

- `Ctrl/Cmd + S` 也能保存
- 操作结果提示显示在标题行（插件名与版本号后面），失败时会逐条列出错误并高亮对应分组

## 数据备份与恢复

「导出 JSON」得到的文件包含当前编辑状态（包括还没保存的修改），适合：

- 重载 / 重装扩展前备份
- 换机器时迁移
- 手工编辑后再导入

导入时会校验 `schemaVersion` 与字段；不合法会逐条提示且**不改动现有配置**。注意：1.0 起配置格式基线为 `schemaVersion 1`，开发期（0.x）导出的旧文件不兼容。

## 常见问题

### 打开页面没有自动归组？

按顺序检查：

1. 分组和全局开关是否都开着
2. 当前 URL 是否命中分组里的某条匹配路径（简写保存后会被展开，可以展开左栏分组看实际路径）
3. 是否设置了 `minTabs` 而当前窗口内命中数量不够
4. 标签页是否已经在**别的**分组里（插件不会把已分组的标签拽走）
5. 页面是保存配置之前就打开的？点一下工具栏的 TabPilot 按钮补同步，或刷新页面

### 页面内标识没有显示？

1. 确认该分组「页面内突出显示」的开关是开的
2. 确认当前页面命中的就是这个分组
3. 刷新页面
4. 在页面控制台执行 `document.documentElement.dataset.tabpilot`：
   - `on`：标识已注入
   - `title`：该分组只开了标题规则，没有页面内标识
   - `off` / `undefined`：没命中分组，或标识没开启

### 标签页标题没有变？

1. 确认该分组的「标签页名规则」开关是开的（关闭时配置区会置灰）
2. 用「测试文本」验证规则本身能命中
3. 确认配置已保存
4. **重载扩展后要刷新页面**——content script 只在页面加载时注入
5. 页面控制台会打印 `[TabPilot] 标题已改写：旧 → 新` 或 `标题规则未命中`

### 安装 Firefox 的 zip 时提示「未通过验证」？

正式版 Firefox 只安装已签名的扩展。未签名的包只能临时加载；要正常安装需先提交 AMO 签名，下载签名后的 `.xpi` 再安装。Chromium 的 `-chromium.zip` 是给商店上传用的，不能直接拖进浏览器；本地请加载 `dist/chromium` 目录。

### 重启浏览器后配置没了？

Firefox 的临时加载随浏览器重启消失，配置也随之清空；先用「导出 JSON」备份，重载扩展后「导入 JSON…」。

Chrome / Edge 的「加载已解压的扩展程序」不会因重启消失，配置会保留；只有手动移除扩展时才会丢失。

### 安装时提示「可访问所有网站的数据」？

页面内标识和标签页改名需要 content script 注入页面。插件只用当前网址做匹配，不读取页面内容、不发起网络请求；Firefox 包的 manifest 里声明了 `data_collection_permissions.required = ["none"]`。

## 隐私与权限

| 权限 | 用途 |
|---|---|
| `tabs` | 读取标签页的 URL / 标题，把标签页移入分组 |
| `tabGroups` | 创建、更新分组（名称 / 颜色 / 折叠） |
| `storage` | 保存规则配置 |
| `*://*/*` content script | 在命中分组的页面上绘制标识、改写标题 |

- 没有任何网络请求，不上传数据，无统计 / 遥测
- 页面内标识是 `pointer-events: none` 的覆盖层，不拦截点击
- 配置只存在本机 `browser.storage.local`

## 已知限制

- 支持 **Firefox 140+** 与 **Chrome / Edge（Chromium 116+）**；Chromium 侧是新支持的平台，`tabGroups` 的折叠等细节可能与 Firefox 略有差异
- 页面内标识在少数强制改写 `z-index` 或使用顶层 iframe 的页面可能被遮住
- 标签页改名靠改 `document.title`：页面自己反复改标题时会跟着重新应用；正则**不支持标志位**（固定区分大小写、只替换第一个匹配），需要忽略大小写可以用 `[Jj]ira` 这种写法
- 不区分 Firefox 容器（Container Tabs）：同一 URL 在不同容器里仍进同一分组
- 不处理 `about:`、扩展商店等受限页面
- MV3 后台在 Firefox 是事件页、在 Chromium 是 service worker，都可能被回收；日志只在控制台和内存里，不落盘

## 致谢

本项目的功能与交互设计从以下浏览器扩展中获得启发，感谢作者们的分享：

- **Tab Rename** —— 启发了「标签页标题可以按需改写」的思路。
  [AMO](https://addons.mozilla.org/zh-CN/firefox/addon/tab-rename/) ·
  [GitHub](https://github.com/trickypr/tab-rename)
- **Auto Tab Groups** —— 启发了「按地址匹配规则自动分组」的设计。
  [AMO](https://addons.mozilla.org/zh-CN/firefox/addon/auto-tab-groups/) ·
  [GitHub](https://github.com/nitzanpap/auto-tab-groups)
- **TabTint** —— 启发了「用页面边框标识当前环境」的呈现方式。
  [AMO](https://addons.mozilla.org/zh-CN/firefox/addon/tabtint/)
- **Environment Marker** —— 启发了「在页面上添加彩色标签」的视觉形式。
  [AMO](https://addons.mozilla.org/zh-CN/firefox/addon/environment-marker-extension/)

以上项目仅作为设计与功能上的参考；本项目为独立实现，未复制或包含它们的源代码。

## 许可证

[MIT](LICENSE)
