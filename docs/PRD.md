# PRD：多浏览器环境标签管理器（项目名：TabPilot）

| 项         | 内容                                                         |
| ---------- | ------------------------------------------------------------ |
| 版本       | v1.1.0（多浏览器）                                             |
| 作者       | 你                                                           |
| 状态       | v1.1.0 开发中：Firefox 已发布，Chromium 待实测                  |
| 目标浏览器 | Firefox 140+、Chrome / Edge（Chromium 116+）                  |
| 技术栈     | 原生 WebExtensions（HTML/CSS/JS）+ Manifest V3，无框架；构建用 Node 脚本 |
| 存储       | `browser.storage.local`，封装存储层                          |

版本号遵循 [SemVer 2.0](https://semver.org/lang/zh-CN/) 三段式 `MAJOR.MINOR.PATCH`；插件版本与配置格式版本 `schemaVersion` 相互独立：前者表示功能演进，后者只在配置 JSON 结构发生不兼容变更时递增。

------

## 1. 背景与问题

当前通过多个独立浏览器插件分别实现“标签页分组、高亮、重命名”等能力，存在：

1. **零碎**：规则散落在多个插件，行为不一致，难以统一调整。
2. **不可控**：无法集中定义“什么 URL 进什么组、什么颜色”。
3. **不可迁移**：配置无法备份/恢复，换机器成本高。
4. **权限冗余**：多个插件叠加申请权限，隐私面扩大。

目标：用一个自制浏览器扩展，以**统一规则引擎**收编 80% 高频场景，其余低频操作保留手动。

## 2. 目标与非目标

### 2.1 目标（v1.0.0 验收）

- 用 JSON 规则定义“URL 匹配 → 分组/颜色/折叠”。
- 规则可启用/禁用、可按顺序决定优先级、支持导入导出。
- 能在控制台排查“哪个 tab 命中哪条规则、做了什么”（不单独做日志页，见 F5）。
- 连续使用一周，可卸载至少一个现有旧插件。

### 2.2 非目标（本阶段明确不做）

- Safari 兼容（Chrome / Edge 已纳入 v1.1 规划，见 §14）。
- 更复杂的规则编辑器（条件组合、表达式、自由画布；当前两栏表单已够用）。
- 云同步、账号体系。
- 标签页名规则已实现（F6）；更复杂的标题模板语法（条件、函数、多规则串联）不做。
- 机器学习/智能推荐规则。
- 按域名细分统计标签数（阈值按规则整体计数，已决策）。
- **按容器（Container Tabs）/ 窗口区分规则**：容器的主要价值是隔离登录态与 Cookie，属于“同一环境多账号”的少见场景；真需要时用不同浏览器或隐私窗口即可，不纳入插件目标。窗口维度也不需要——分组本身已按窗口隔离，同一窗口内不需要多套规则。
- 任何形式的数据上传。

## 3. 用户与场景

**目标用户**：需要频繁在多环境之间切换的开发者，日常使用 Firefox / Chrome / Edge。

核心场景：

| #    | 场景                        | 期望行为                   |
| ---- | --------------------------- | -------------------------- |
| S1   | 打开 `localhost:*` 调试服务 | 自动进入“开发”组，绿色     |
| S2   | 打开 GitHub / GitLab        | 自动进入“代码”组，蓝色     |
| S3   | 打开 Jira / Confluence      | 自动进入“工作”组，橙色     |
| S4   | 同一分组规则命中的标签过多   | 可选：同一窗口内命中该规则的标签数达到规则阈值（`minTabs`）时自动归组；按规则整体计数，不按域名细分 |
| S5   | 临时不想被自动分组          | 可禁用单条规则或全局暂停   |
| S6   | 换机器                      | 导出 JSON 配置，新机器导入 |

## 4. 功能需求

### F1 规则引擎自动分组（P0，核心）

- 监听 `tabs.onCreated`、`tabs.onUpdated`（仅 `status === "complete"` 或 URL 变化时触发）。
- 按规则在配置中的顺序（即优先级）匹配 URL；命中后执行动作。
- 阈值：每条规则可自定义 `minTabs`（默认 `1`，即命中即归组）。设为 N 时，只有同一窗口内命中该规则的标签页数量 ≥ N 才归组；未达阈值的规则不生效，继续尝试后续规则。计数按规则整体统计，不做域名细分（已决策）。达成阈值时，同窗口内命中该规则且尚未归入任何分组的标签页一并归组，已在其他分组内的标签保持不动。
- 幂等：已处于目标组/颜色则不重复操作。
- 全量同步：事件监听覆盖不到已打开的标签页，因此提供「同步」动作——保存配置后自动执行，也可由工具栏按钮或控制台手动触发。默认跳过已在分组内的标签，避免覆盖手动整理结果。
- 防循环：用 `handled` 标记或状态比较，避免分组引发 `onUpdated` 死循环。
- 批量/防抖：短时间多个 tab 事件合并处理。

**验收**：打开 3 个 `localhost` 页面，自动进入同一“开发”组、绿色，日志各打印一条命中记录。

### F2 分组属性设置（P0）

- 支持设置分组：名称、颜色（Firefox 预设色）、是否折叠。
- 折叠在 Firefox 上按原生行为处理；跨浏览器折叠差异不在本版范围。

**验收**：规则中改颜色后，新命中 tab 使用新颜色；已有组按规则更新。

### F3 规则管理（P1）

- 规则字段：`id`、`enabled`、`name`、`color`、`collapsed`、`minTabs`、`note`、`patterns[]`。
- 支持启用/禁用单条规则；支持全局暂停开关。
- 冲突处理：规则按数组顺序匹配，靠前的优先；默认一个 tab 只应用一个分组规则。
- 阈值按规则独立配置，不同规则组互不影响。
- 新建分组按序号在 9 个预设色里循环取色（`index % 9`），相邻分组默认不同色，减少手动改色的次数。
- 配置界面为两栏布局：左栏分组列表只做展示与选中（色块、名称、iOS 风格拨杆表示启用状态、⋯ 菜单内排序与删除），左栏不提供编辑入口。右栏分成三个可独立折叠的区块（折叠状态存 localStorage，默认只展开基础配置；折叠时标题栏右侧显示该区块状态——突出显示为启停拨杆，标签页名规则为「规划中」徽标）：**基础配置**（分组名/颜色/阈值/启用/命中后折叠、备注、匹配路径）、**页面内突出显示**（开关、示意预览、边框与 banner 配置）、**标签页名规则**（占位，后续实现）。不使用裸 JSON 编辑（JSON 导入导出属 F4）。
- 匹配路径自动补全：输入简写即可，离开输入框或保存时展开为完整模式——不带协议补 `*://`；只写主机且无路径时同时生成「任意端口」与「无端口」两条（如 `192.168.3.213` → `*://192.168.3.213:*/*`、`*://192.168.3.213/*`）；已写端口则不展开端口变体；结尾自动补 `/*`。

**验收**：禁用某规则后，新 tab 不再命中；重新启用恢复。

### F4 配置导入/导出（P1）

- 导出为 JSON 文件（含 `schemaVersion`），文件名带日期；入口与其他全局按钮一起放在工具栏。
- 导出内容为页面当前编辑状态（含尚未保存的修改）。
- 导入时校验 schema 版本与字段合法性，非法则拒绝并逐条提示，不改动现有配置；`schemaVersion` 不是当前基线（1）时直接拒绝，不做迁移。
- 导入确认后替换当前配置，立即保存并同步已打开的标签页。
- 支持“恢复默认”。

**验收**：导出 → 清空 → 导入，规则与行为完全恢复。

### F5 操作日志（开发期辅助，不做独立页面）

- 记录：时间、tab URL、命中规则 id、执行动作、结果/错误。
- 结论：日志的主要使用者是开发者本人，交付给用户价值很低。因此**不做独立日志页**，保持控制台输出即可。
- `explain()` 输出的 steps（哪条规则没命中、数量差多少）继续打印到控制台，作为排查「为什么没进组」的手段。
- 日志仅本地、不上传；内存环形缓冲保留供调试。

### F6 标签页名规则（P2，实验 → v0.5.0 已实现）

- 通过 content script 修改 `document.title` 实现；只要标题规则开着就持续监听：**初始标题不匹配也不会放弃**，等页面把标题改成最终值后再应用；之后每次改名（含单页应用路由切换）都会重新按顺序匹配。另有每 1.5s 的低频兜底检查（页面持续反复改标题时也会跟着重试）。
- 每个分组可配置**多条命名规则**：`titleRule = { enabled, rules: [{ pattern, replacement, description }], testText }`。
  - `pattern`：源文本（正则表达式），只替换第一个匹配；
  - `replacement`：目标文本，支持 `$1`/`$2`、`$<name>`、`$&`、`$$`，可基于匹配组重排标题；需要加前缀直接写在这里（例如 `W· $1`）；
  - `description`：说明文字，仅用于配置页展示。
- **匹配顺序**：按 `rules` 数组从上到下匹配，**命中第一条就停止**，后续规则不再尝试；全部未命中时标题保持不变。
- 正则无效时跳过该条并打印控制台警告，不影响后面的规则，也不影响 F1 的分组逻辑。配置页保存前会校验每条 `pattern` 是否为合法正则，非法时直接拒绝保存并指出 `rules[i].pattern`。
- 配置页「标签页名规则」区块：启用开关 + 规则卡片列表（可 ↑/↓ 调整顺序、删除、新增）+ **测试区域**。测试文本**每行一个标题**，点「查看效果」逐行输出处理结果；未匹配的行标注「未匹配，保持原样」。**总开关未开启时整块置灰并禁用输入**，避免配置了却不生效。
- **测试文本持久化**：`titleRule.testText` 随配置保存，下次打开配置页（或导出/导入）后仍然可用。
- 与页面内标识相互独立：只开标题规则也会下发配置；只开标识则不处理标题。

**验收**：给「开发」分组配置两条规则——`^\[工作\]\s*(.*)$` → `W· $1`，`^(.*) - (.*)$` → `$2 · $1`；打开标题为 `[工作] Jira - 看板` 的页面，标题变为 `W· Jira - 看板`（第一条命中后停止）；多行测试区对每行分别显示结果，测试文本保存后重开配置页仍在。

### F7 页面内标识（P1）

- 每个分组独立的开关：开启后，命中该分组的页面里显示标识；关闭或未命中则不注入任何元素。默认配置为**四边边框 + 左上角 banner**（开关默认关闭）。
- 边框：可勾选上 / 下 / 左 / 右，宽度可调（1–24px），颜色取该分组的颜色。
- 不透明度：边框与 banner **分别控制**（0–100）。边框默认 100（不透明），banner 默认 60，便于既醒目又不完全遮挡内容。
- 配置页提供 16:9 的示意预览：用细条/斜线标出边框与 banner 的目标区域，颜色与透明度跟随配置，banner 内以 `XXX` 占位；不按真实尺寸渲染、不显示真实分组名，仅用于快速确认位置。
- Banner：可选上 / 下 / 左 / 右与四个角；上下为贴着上/下边缘的小横标签、左右为贴着左/右边缘的小竖标签，长度随文字收缩（只比文字略宽），靠页内一侧做圆角。四个角为 45° 斜带，横跨角部，**两端越过页面边缘并被裁掉**（不会露出方角）。文案为分组名，尺寸（8–160px）与字号（8–32px）可调。
- 覆盖层 `position: fixed`、`pointer-events: none`，不拦截页面交互；配置保存后已打开的页面立即重绘。
- 实现：content script 注入所有 http(s) 页面，仅用当前网址向 background 询问匹配结果；不读取页面内容、不发起网络请求。

**验收**：给「开发」分组开启上下边框 + 右上角斜向 banner，打开 `localhost` 页面即可看到；修改颜色/宽度/字号并保存后，页面无需刷新即更新。

## 5. 数据模型

`schemaVersion: 1`（1.0 起的基线）。一条规则对应一个标签页分组，`patterns` 可包含多个匹配路径，数组顺序即优先级，`highlight` 描述页面内标识，`titleRule` 描述标签页名规则。

```json
{
  "schemaVersion": 1,
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
        "enabled": true,
        "border": { "sides": ["top", "bottom"], "width": 6, "opacity": 100 },
        "banner": { "positions": ["topRight"], "size": 34, "fontSize": 15, "opacity": 60 }
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
            "description": "通用重排"
          }
        ],
        "testText": "[工作] Jira - 看板\nJira - GitHub"
      }
    }
  ]
}
```

- 存储键：`tabpilot:config`（配置）；日志只在内存与控制台，不落盘。
- 所有读取经存储封装层，不散落直接调用 `browser.storage.local`。
- **分组阈值 `minTabs`**：整数，默认 `1`。值 N 表示同一窗口内命中该规则的标签页数量达到 N 时才执行归组（多域名合并的规则一起计数，不按域名细分）。该字段属于规则自身，不同规则组各自定义、互不影响。
- **优先级**：不再用显式字段，规则在 `rules` 数组中的顺序就是匹配顺序，靠前的优先；配置页用上移/下移调整。
- **匹配路径**：`patterns` 数组，任一命中即视为该规则的 URL 命中。
- **页面内标识 `highlight`**：`enabled` 开关；`border.sides` ⊂ top/right/bottom/left，`border.width` 1–24；`banner.positions` ⊂ top/right/bottom/left/topLeft/topRight/bottomRight/bottomLeft，`border.opacity` 0–100（默认 100）、`banner.size` 8–160、`banner.fontSize` 8–32、`banner.opacity` 0–100（默认 60）。缺省或越界由 `highlight.js` 收敛到合法值；早期统一写法 `highlight.opacity` 仍可读，作为两部分的兜底。
- **标签页名规则 `titleRule`**：`enabled` 开关；`rules[]` 是按顺序匹配的命名规则，每条含 `pattern`（正则，不带标志位，只替换第一个匹配）、`replacement`（替换串，支持 `$1`/`$<name>`/`$&`/`$$`，需要加前缀直接写在这里）、`description`（说明）；`testText` 是多行测试文本，随配置保存。命中第一条规则即停止；正则非法时运行期跳过并告警，保存前校验会拒绝非法 `pattern`。早期带 `prefix` 字段的写法会在读取时自动折算进 `replacement`。
- **基线说明**：1.0 起配置格式版本从 `1` 重新起算。开发期的 `schemaVersion 2–5` 属于过渡格式，**不再兼容、也不再迁移**（读取时按校验失败回退默认配置，导入时直接拒绝）。以后的结构变更从 1 开始递增，并在当次改动里补迁移。
- `schemaVersion` 与插件版本号解耦，仅随配置结构的不兼容变更递增。

## 6. 非功能需求

| 类别   | 要求                                                         |
| ------ | ------------------------------------------------------------ |
| 性能   | 单次 tab 事件处理 < 50ms；批量合并；不影响页面加载；页面标识只在命中时注入 |
| 可靠性 | 幂等 + 防循环；单条规则异常不影响其他规则；注入失败要静默降级 |
| 隐私   | 无网络请求上传数据；content script 只用当前网址做规则匹配，不读取页面内容；manifest 声明 `data_collection_permissions.required = ["none"]` |
| 权限   | 已接受：`tabs`、`tabGroups`、`storage`，外加页面内标识所需的 content script 全站注入（`*://*/*`，安装时提示可访问所有网站数据）；只用网址做匹配，不读取页面内容、不上传数据 |
| 可测试 | 规则引擎与标识规格为纯函数，可脱离浏览器单测                 |
| 可维护 | 规则引擎 / 动作执行 / 存储 / 标识规格分层                    |

## 7. 技术架构（概要）

```
background.js      事件监听 + 调度；回答 content script 的页面标识 / 标题规则查询
  ├─ rules.js      纯函数：match(tab, rules) → 命中的规则
  ├─ actions.js    执行 browser.tabs.group / tabGroups.update
  ├─ store.js      封装 storage.local 读写 + schema 校验（基线 schemaVersion 1）
  ├─ highlight.js  页面内标识规格：默认值、边界收敛、几何（纯函数）
  ├─ title-rule.js 标签页名规则：正则编译与替换（纯函数）
  └─ logger.js     控制台日志（开发期辅助）
content.js         content script：按 background 下发的规格绘制边框与 banner、改写页面标题
options.html/js    两栏配置页：左栏分组列表（只读、选中、排序/删除），右栏三段可折叠详情（基础配置 / 页面内突出显示 / 标签页名规则）；工具栏含保存/放弃/恢复默认与导入/导出
manifest.json      MV3，background.scripts（非 service worker）+ content_scripts
```

**为未来多浏览器预留的薄缝**（本版不实现兼容层）：

1. 规则引擎与 `browser.*` API 解耦（只依赖 actions 层）。
2. 存储封装层（以后换 IndexedDB/同步只改此层）。
3. 配置带 `schemaVersion`，便于以后从 1.0 的基线做迁移。

## 8. 版本规划

| 版本     | 内容                                                         | 验收                    |
| -------- | ------------------------------------------------------------ | ----------------------- |
| v0.1.0   | 临时加载插件；内置默认单规则：`localhost` → “开发”组绿色；控制台日志；全量同步（工具栏按钮） | 3 个 localhost 自动归组 |
| v0.2.0   | 两栏配置页：左栏分组列表（颜色/启用/排序/删除），右栏分组详情（多匹配路径 + 自动补全、阈值、折叠、备注）；配置结构升级到 `schemaVersion 2` 并自动迁移旧配置 | 改规则后行为变化 |
| v0.3.0   | 配置导入/导出：工具栏「导出 JSON」「导入 JSON…」，导入校验（v1 自动迁移）、覆盖确认、导入后自动同步；日志页取消（改为控制台辅助） | 换机器 / 重载后可恢复配置 |
| v0.4.0   | 页面内标识：分组开关；边框（上下左右可选、宽度可调、颜色取自分组）；banner（上下左右 + 四角斜向、显示分组名、尺寸/字号可调）；配置结构升级到 `schemaVersion 3` 并自动迁移 | 命中分组的页面无刷新即显示标识 |
| v0.5.0   | 标签页名规则：每个分组可配置多条命名规则（源文本 / 目标文本 / 描述），按顺序匹配、命中第一条即停止；配置页多行测试并保存测试文本；配置结构升级到 `schemaVersion 5` 并自动迁移 | 命中页面的标题按首条命中规则改写，测试文本可复用 |
| v1.0.0   | 正式发布：功能集合与 v0.5.0 相同；配置格式重新基线为 `schemaVersion 1`，开发期过渡格式（2–5）作废、不再迁移 | 发布 + 连续使用一周、卸载一个旧插件 |
| v1.0.1   | 重新打包上传：AMO 上 1.0.0 已上传过并删除，版本号不可复用；内容与 1.0.0 相同 | 与 1.0.0 相同 |
| v1.1.0   | 多浏览器兼容（Chrome / Edge）与多目标构建：`manifests/base.json` + 目标覆盖；`browser` shim；Chromium service worker 入口；`archiver` 双目标打包 | 已实现；Firefox 通过 lint，Chromium 待实机验证 |
| v1.2.0+  | 页面内标识的更多样式；标题规则支持正则标志位等增强           | 不阻塞主线              |

> v0.1–v0.5 中出现的 `schemaVersion` 递增与迁移链已在 v1.0.0 移除：1.0 起配置格式基线重新从 1 算起，历史格式不再兼容（见 §5 基线说明）。表中的“自动迁移”仅记录当时的实现。

## 9. 里程碑与时间（碎片时间制）

- 第 1 周：v0.1.0 + v0.2.0（周末 2h 集中 + 2 个晚 20min）
- 第 2 周：v0.3.0
- 第 3 周：v0.4.0
- 第 4 周：v1.0.0 使用验证 + 复盘
- 每周稳定 3–4 小时，不占用睡眠。

## 10. 风险与开放问题

| 风险                                     | 应对                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| Firefox 版本 < 140 无 `tabGroups` / 不支持数据收集声明 | 开工前 `about:support` 确认；低于则升级或降级为高亮/标签管理 |
| `tabGroups` 折叠行为在不同浏览器不一致 | 记录差异，按浏览器分支补兼容                         |
| 标签页名规则被页面覆盖                 | 页面加载/路由变化后重新应用；关闭规则时恢复原标题；已知限制写进 README |
| 规则冲突导致抖动                         | 优先级 + 单分组规则 + 幂等 + 日志                            |
| 碎片时间导致中断                         | `NEXT.md` 记录下一步；每晚最低 5 分钟不断线                  |

**开放问题**：

1. ~~是否需要“同域名超过 N 个自动归组”？~~ 已决策：需要阈值机制，但**不做域名细分**——阈值按「同一窗口内命中该规则的标签数」整体统计（`minTabs`，默认 1），见 §5。
2. ~~日志用 `storage.local` 还是 IndexedDB？~~ 已决策：不做日志页，日志只在控制台与内存，用于开发期排查。
3. ~~是否需要“按容器/窗口”区分规则？~~ 已决策：**不做**。容器用于隔离登录态，属于同一环境多账号的少见场景，真需要时可用不同浏览器或隐私窗口；窗口维度也不需要（分组本身已按窗口隔离）。见 §2.2 非目标。

## 11. 成功指标

- 连续 7 天日常使用，无阻断性 bug。
- 至少替代 1 个现有插件。
- 配置可导出并在另一台机器恢复。
- 每晚投入 ≤ 40 分钟，不影响 23:00 前睡觉。

## 12. 功能实现状态（v1.0.0）

| 编号 | 功能 | 优先级 | 状态 |
|---|---|---|---|
| F1 | 规则引擎自动分组：监听 `tabs.onCreated` / `tabs.onUpdated`，防抖合并、按顺序匹配、幂等执行、单条异常不影响其他标签 | P0 | 已完成（v0.1.0），单测 + Firefox 实机验证 |
| F1b | 全量同步：把已打开的标签页按规则过一遍；保存配置后自动执行，工具栏按钮可手动触发；默认跳过已在分组内的标签 | P0 | 已完成（v0.1.0），单测 + 实机验证 |
| F2 | 分组属性：名称、颜色（Firefox 预设色）、是否折叠；已有组按规则增量更新 | P0 | 已完成（v0.1.0），名称与颜色实机验证 |
| F3 | 规则管理：两栏配置页，左栏只读分组列表（选中 / 排序 / 删除），右栏编辑分组名 / 颜色 / 启停 + 多匹配路径 / 阈值 / 折叠 / 备注、全局暂停；保存前校验并高亮出错分组 | P1 | 已完成（v0.2.0），实机验证 |
| F4 | 配置导入 / 导出：导出 JSON、导入校验 `schemaVersion` 与字段、覆盖前确认、导入后自动同步 | P1 | 已完成（v0.3.0），实机验证 |
| F5 | 操作日志：记录时间、URL、命中规则、动作、结果 / 错误 | 开发期辅助 | **不做独立日志页**；`explain()` 的 steps 输出到控制台，内存环形缓冲保留供调试 |
| F6 | 标签页名规则：每个分组可配置多条命名规则（源文本 / 目标文本 / 描述），按顺序匹配、命中第一条即停止；支持捕获组重排；配置页带多行测试区域，测试文本随配置保存 | P2 | 已完成（v0.5.0），实机验证 |
| F7 | 页面内标识：按分组绘制边框（上下左右可选、宽度可调、颜色取自分组）与 banner（上下左右贴边小标签 + 四角斜带，显示分组名，尺寸 / 字号 / 不透明度可调）；配置页带示意预览框 | P1 | 已完成（v0.4.0），实机验证 |

**F1 验收**：打开 3 个 `localhost` 页面，自动进入同一「开发」组、绿色，控制台各打印一条命中记录。

## 13. 本地开发、验证与发布

### 13.1 目录与分层

```
manifests/
  base.json            共享 manifest 字段
  manifest.firefox.json  浏览器专用字段：background.scripts + browser_specific_settings
  manifest.chromium.json Chromium 专用字段：background.service_worker
src/
  core/                纯逻辑，不依赖 browser / DOM
    rules.js           规则引擎：match / explain，可脱离浏览器单测
    highlight.js       页面内标识规格：默认值、边界收敛、几何
    title-rule.js      标签页名规则：正则编译与替换
    logger.js          日志：控制台 + 内存环形缓冲
  app/                 业务与浏览器 API
    store.js           存储封装：storage.local 读写 + schema 校验 + 默认配置（基线 schemaVersion 1）
    actions.js         动作执行：唯一调用 tabs.group / tabGroups.* 的层
    background.js      事件监听 + 防抖调度：唯一做编排的地方
    content.js         content script：绘制边框与 banner、改写页面标题
  ui/
    options.html       配置页：两栏布局（左分组列表 / 右分组详情）
    options.js         配置页逻辑（选中、排序、删除、路径补全、页面内标识、标题规则、校验提示、保存后同步）
  platform/
    chromium/
      browser-shim.js  把 chrome 命名空间暴露为 browser（仅 Chromium 加载）
      background.js    Chromium MV3 service worker 入口（importScripts 加载 core/app）
test/
  rules.test.js        规则匹配、顺序优先级、阈值、窗口隔离、路径补全
  store.test.js        配置校验（minTabs / 颜色 / highlight / titleRule）与默认值
  highlight.test.js    页面内标识规格：默认值、边界收敛、过滤去重、几何
  title-rule.test.js   命名规则：顺序匹配、捕获组重排、非法正则、多行批处理
  background.test.js   编排链路：事件、同步、工具栏、消息、页面标识、标题规则、调试入口
scripts/build-targets.mjs 多目标构建：合并 manifest、复制 dist、archiver 打包
package-lock.json      锁定构建依赖版本（web-ext / archiver）
dist/                  构建产物（gitignored）：dist/firefox、dist/chromium
icons/                 扩展图标：icon-{16,32,48,96,128}.png
docs/PRD.md            本文件
```

分层意图：规则引擎与 `browser.*` 解耦（只吃 tab / rules / context），存储层可整体替换，动作为唯一直接碰浏览器分组 API 的地方。以后换 IndexedDB、加新的浏览器平台都只改对应一层。

### 13.2 常用命令

```bash
npm install           # 安装开发依赖（web-ext / archiver）
npm test              # 119 个单测（node:test）
npm run build         # 构建 Firefox + Chromium 两个目标
npm run build:firefox # 只构建 Firefox
npm run build:chromium# 只构建 Chromium
npm run lint          # web-ext lint 检查 dist/firefox
```

- 版本号只在 `package.json` 维护，构建时注入各目标的 manifest。
- Firefox 与 Chromium 共用 `src/`，差异只在 `manifests/` 和构建脚本里。
- 有单测的是纯逻辑（规则引擎、配置校验、编排链路、标识规格、标题规则）；`options.js` 是纯 DOM 绑定，改动后手动确认页面与保存流程。

### 13.3 本地加载与验证

1. `about:support` 确认 Firefox 版本 ≥ 140（`tabGroups` API 与 `data_collection_permissions` 字段依赖）。
2. 运行 `npm run build`，打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `dist/firefox/manifest.json`。
   Chromium 则在 `chrome://extensions` / `edge://extensions` 打开开发者模式，加载 `dist/chromium` 目录。
3. 打开 3 个 `localhost` 页面，预期全部进入「开发」组且为绿色。
4. 在 `about:debugging` 里点插件的「检查」，控制台应能看到每次命中的日志。
5. `about:addons` → TabPilot → 首选项打开配置页，加一条 github 规则并保存，确认已打开标签立刻被同步。

注意：**重载扩展后，已打开页面里的 content script 不会自动更新**，需要刷新页面才能看到新的标识 / 标题逻辑。

### 13.4 控制台调试入口

配置页之外，`TabPilotDebug` 可直接操作配置（扩展调试控制台里执行）：

| 操作 | 命令 | 语义 |
|---|---|---|
| 增 / 改一条规则 | `await TabPilotDebug.addRule(rule)` | 按 `id` 去重后追加，其余规则保留；保存后自动同步 |
| 删一条规则 | `await TabPilotDebug.removeRule(id)` | 只删指定规则 |
| 整份替换 | `await TabPilotDebug.setConfig(config)` | 覆盖整个配置，不合并；保存后自动同步 |
| 查看当前生效配置 | `await TabPilotDebug.getConfig()` | 返回 `{ config, source, errors? }` |
| 恢复默认 | `await TabPilotDebug.resetConfig()` | 删除存储的配置，回到内置默认 |

重要区别：**默认规则（`dev-localhost`）只在「storage 里没有配置」时作为兜底生效**；一旦写入过配置，它就只是被写入内容的一部分。`setConfig` 只写 github 一条规则时，localhost 不再自动归组；想两条都在，用 `addRule` 或一次写全。

### 13.5 排查「某个 tab 为什么没归组」

在扩展的调试控制台（`about:debugging` → 「检查」）里执行：

```js
(async () => {
  const { config, source, errors } = await TabPilotStore.loadConfig();
  console.log('配置来源:', source, '校验错误:', errors ?? '无');
  console.table(config.rules.map((r) => ({
    id: r.id, enabled: r.enabled, name: r.name,
    patterns: (r.patterns || []).join(' | '),
    minTabs: r.minTabs ?? 1,
    highlight: r.highlight ? r.highlight.enabled : false,
    titleRule: r.titleRule ? r.titleRule.enabled : false
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

### 13.6 打包与发布

- `npm run build` 生成两个目标：`dist/firefox/` + `output/tabpilot-<version>-firefox.zip`，`dist/chromium/` + `output/tabpilot-<version>-chromium.zip`。
- Firefox 继续用 `web-ext lint` / AMO 签名；Chromium 包是普通 zip，不需要签名，同一份可上传 Chrome Web Store 和 Edge Add-ons。
- `npm run lint` 只检查 `dist/firefox`，Chromium manifest 的合法性由上传时的商店校验兜底。
- 正式版 Firefox 只安装已签名扩展：未签名 zip 只能临时加载；正常安装需提交 AMO 签名（listed 上架或 unlisted 自分发），下载签名后的 `.xpi` 安装。
- manifest 已声明 `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`（AMO 新扩展必填）。
- 每次上传新版本必须递增版本号，且 `manifest.json` 与 `package.json` 保持一致。

## 14. 多浏览器兼容与多目标构建（v1.1.0）

### 14.1 目标与范围

- 保持 Firefox 140+ 为第一优先级，现有功能与配置格式不变。
- 新增 **Chrome / Edge**（Chromium MV3）支持；Safari 暂不涉及。
- 目标是同一套规则、同一份配置，在三个浏览器上行为一致（受各浏览器 tabGroups 能力差异约束）。

### 14.2 兼容层（已实现）

| 差异点 | 处理方式 |
|---|---|
| `browser` vs `chrome` 命名空间 | `src/platform/chromium/browser-shim.js` 只在 Chromium 目标加载：后台由 service worker 入口先加载，content script 由 Chromium manifest 单独声明，options 页由构建脚本注入；Firefox 包不含这个文件 |
| 后台形态 | Firefox 用 `background.scripts`；Chromium 用 `src/platform/chromium/background.js` 作为 service worker，`importScripts` 按同样顺序加载后台代码 |
| 消息协议 | 后台的 `runtime.onMessage` 改为 `sendResponse` + `return true`，Firefox 与 Chromium 都支持；不再依赖「监听器返回 Promise」 |
| manifest 差异 | Firefox 的 `browser_specific_settings` 与 `background.scripts` 只进 Firefox manifest；Chromium manifest 使用 `service_worker` + `minimum_chrome_version`，并单独声明带 shim 的 `content_scripts` |
| tabGroups API | 两边都声明 `tabGroups` 权限，共用 `actions.js`；折叠等行为差异待 Chromium 实测确认 |
| options 页 / content script | 同一份 `options.html` 与 `content.js`，只额外加载 shim |

### 14.3 构建结构（已实现）

```
manifests/base.json           共享字段（name、permissions、action、icons、content_scripts）
manifests/manifest.firefox.json   background.scripts + browser_specific_settings
manifests/manifest.chromium.json  service_worker + minimum_chrome_version
scripts/build-targets.mjs      合并 manifest、复制 src/icons/LICENSE 到 dist、archiver 打包
```

- 版本号只在 `package.json` 维护，构建时注入两份 manifest。
- 目标专用文件在复制后按目标剔除：Firefox 包不含整个 `src/platform/chromium/`（含 shim 与 service worker 入口），Chromium 包保留。
- Chromium 的配置页由构建脚本在 `options.html` 中注入 shim 的 `<script>`，共享源码里的 `options.html` 保持无平台依赖。
- 产物：`dist/firefox` + `output/tabpilot-<version>-firefox.zip`；`dist/chromium` + `output/tabpilot-<version>-chromium.zip`。
- Firefox 用 `web-ext lint` / AMO 签名；Chromium 是普通 zip，同一份上传 Chrome Web Store 和 Edge Add-ons，不需要区分包。
- `npm run build` 构建两个目标；`build:firefox` / `build:chromium` 单独构建。

### 14.4 验收

1. 同一份导出 JSON 在 Firefox / Chrome / Edge 导入后，规则、分组颜色、阈值行为一致。
2. 页面内标识与标签页名规则在 Chromium 上可用（含 SPA 标题变化、页面刷新）。
3. 两个目标包都能通过各自商店的校验：Firefox `web-ext lint` 无错误，Chrome / Edge 上传无 manifest 错误。
4. 版本号、仓库 tag、商店版本三者一致。

当前状态：构建与 Firefox lint 已通过（0 error / 1 条 Android 版本警告）；Chromium 需在 Chrome 或 Edge 里实际加载 `dist/chromium` 验证分组、标识、标题规则后再算完成。

### 14.5 风险

- Chromium 的 `tabGroups` 与 Firefox 存在行为差异，可能需要按浏览器分支少量逻辑。
- MV3 service worker 会被回收，现有事件页的防抖/内存状态假设需要复核。
- 两套 manifest 带来维护成本，必须用脚本生成而不是手改。
- 商店审核策略不同：Firefox 关注数据收集声明，Chrome / Edge 关注权限最小化与隐私说明。
