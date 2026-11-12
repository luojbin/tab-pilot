# TabPilot

一个自用的 Firefox 标签页管理器：用 JSON 规则把 URL 匹配到「分组 + 颜色 + 折叠」，收编掉当前零散安装的多个标签管理插件。

- **技术栈**：原生 WebExtensions（HTML / CSS / JS）+ Manifest V3，无构建、无框架
- **目标浏览器**：Firefox 139+（仅此，多浏览器为后续计划）
- **存储**：`browser.storage.local`，统一走封装层
- **隐私**：纯本地运行，无任何网络请求上传数据

> 当前状态：**全部规划中，尚无代码实现**。仓库里只有产品设计文档 [`docs/PRD.md`](docs/PRD.md) 与本说明。

---

## 要解决的问题

现状是用多个独立插件分别实现「标签页分组、高亮、重命名」，代价是：

1. **零碎** —— 规则散落在多个插件，行为不一致，难以统一调整。
2. **不可控** —— 无法集中定义「什么 URL 进什么组、什么颜色」。
3. **不可迁移** —— 配置无法备份 / 恢复，换机器成本高。
4. **权限冗余** —— 多个插件叠加申请权限，隐私面扩大。

目标是用一个自制插件以**统一规则引擎**覆盖 80% 高频场景，其余低频操作保留手动。

## 目标与非目标

**v1.0 目标**

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
| S4 | 同域名标签过多 | 可选：超过 N 个时自动归组 |
| S5 | 临时不想被自动分组 | 可禁用单条规则或全局暂停 |
| S6 | 换机器 | 导出 JSON 配置，新机器导入 |

## 功能清单与实现状态

| 编号 | 功能 | 优先级 | 状态 |
|---|---|---|---|
| F1 | 规则引擎自动分组：监听 `tabs.onCreated` / `tabs.onUpdated`，按优先级匹配 URL 并执行动作；幂等、防循环、批量防抖 | P0 | 规划中 |
| F2 | 分组属性设置：名称、颜色（Firefox 预设色）、是否折叠 | P0 | 规划中 |
| F3 | 规则管理：规则启用 / 禁用、优先级、全局暂停开关、冲突处理（高优先级优先，一个 tab 只应用一个分组规则） | P1 | 规划中 |
| F4 | 配置导入 / 导出：带 `schemaVersion` 的 JSON，导入时校验版本与字段合法性，支持恢复默认 | P1 | 规划中 |
| F5 | 操作日志：记录时间、tab URL、命中规则 id、动作、结果 / 错误；可查看最近 200 条、可清空 | P1 | 规划中 |
| F6 | 标签页重命名（实验）：通过 content script 改 `document.title`，失败静默降级并记日志，不阻塞 F1 | P2 | 规划中（不阻塞 v1.0） |

**验收标准（F1）**：打开 3 个 `localhost` 页面，自动进入同一「开发」组、绿色，日志各打印一条命中记录。

## 版本规划与进度

| 版本 | 内容 | 状态 |
|---|---|---|
| v0.1 MVP | 临时加载插件；单条 `localhost` → 「开发」组绿色规则；控制台日志 | 规划中 |
| v0.2 | 规则从 `storage.local` 读取；JSON textarea 编辑；全局开关 | 规划中 |
| v0.3 | 多规则 + 优先级 + 启用 / 禁用；操作日志页 | 规划中 |
| v0.4 | 导入 / 导出 + schema 校验 + 恢复默认 | 规划中 |
| v1.0 | 稳定自用一周；卸载至少一个旧插件 | 规划中 |
| v1.x | 标签页重命名实验、同域名超 N 自动归组 | 规划中 |

## 数据模型

配置存放在 `storage.local` 的 `tabpilot:config`，日志存放在 `tabpilot:logs`。

```json
{
  "schemaVersion": 1,
  "globalEnabled": true,
  "rules": [
    {
      "id": "dev-localhost",
      "enabled": true,
      "priority": 100,
      "note": "本地开发环境",
      "match": { "urlPattern": "*://localhost:*/*" },
      "actions": [
        { "type": "group", "name": "开发", "color": "green", "collapsed": false }
      ]
    }
  ]
}
```

所有读取都经存储封装层，不在各处直接调用 `browser.storage.local`。

## 架构规划

```
background.js      事件监听 + 调度
  ├─ rules.js      纯函数：match(tab, rules) → actions[]
  ├─ actions.js    执行 browser.tabs.group / tabGroups.update
  ├─ store.js      封装 storage.local 读写 + schema 校验
  └─ logger.js     写日志、读日志
options.html/js    规则 JSON 编辑 + 导入导出 + 全局开关
logs.html/js       日志查看
manifest.json      MV3，background.scripts（非 service worker）
```

为未来多浏览器预留的薄缝（本版不实现兼容层）：

1. 规则引擎与 `browser.*` API 解耦，只依赖 actions 层
2. 存储封装层，以后换 IndexedDB / 同步只改此层
3. 配置带 `schemaVersion`，便于迁移

## 目录结构

```
docs/PRD.md    产品设计文档（需求、场景、架构、版本规划的完整依据）
src/           插件源码（待创建）
output/        构建 / 打包产物出口（待定）
```

## 非功能要求

| 类别 | 要求 |
|---|---|
| 性能 | 单次 tab 事件处理 < 50ms；批量合并；不影响页面加载 |
| 可靠性 | 幂等 + 防循环；单条规则异常不影响其他规则 |
| 隐私 | 无网络请求上传数据；权限最小化 |
| 权限 | 首版仅 `tabs`、`tabGroups`、`storage` |
| 可测试 | 规则引擎为纯函数，可脱离浏览器单测 |
| 可维护 | 规则引擎 / 动作执行 / 存储 三层分离 |

## 本地加载（待实施后补充）

Firefox 中通过 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」选择 `manifest.json`。该步骤在 v0.1 代码落地后验证。

## 已知风险

- Firefox 版本低于 139 无 `tabGroups` API，开工前需在 `about:support` 确认版本
- MV3 后台为事件页、会被回收，跨事件的运行状态不能只放内存
- 标签页重命名不稳定，已标 P2，不进 v1.0 验收

## 许可证

[MIT](LICENSE)
