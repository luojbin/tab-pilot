# TabPilot 配置 JSON 格式参考

本文记录正式发布后的配置格式历史及当前开发格式。`schemaVersion` 是配置格式版本，与插件的 `MAJOR.MINOR.PATCH` 版本号相互独立。

| schemaVersion | 对应插件版本 | 状态 | 主要区别 |
|---|---|---|---|
| `2` | v1.3.0 | 当前开发格式，未确认发布 | 移除全局启停；标题 / URL 双来源；结构化测试用例 |
| `1` | v1.0.0–v1.2.0 | 历史正式格式，已核对 v1.0.1、v1.1.0、v1.2.0 标签 | 全局启停；标题单来源正则；多行测试文本；v1.2.0 增加可选全局字段 |

早期 v0.x 开发阶段曾使用相同的版本编号，但结构不同，不属于本参考的兼容范围。不能仅凭编号把开发期旧文件视为这里的 schema 1 或 2。

## 文件和存储约定

- 文件为 UTF-8 JSON，根节点是对象，不支持注释或尾随逗号。
- 导入 / 导出文件和 `browser.storage.local` 中 `tabpilot:config` 的值使用同一结构。文件根节点直接是配置，不需要再包一层 `tabpilot:config`。
- `rules` 为分组规则数组，数组顺序就是优先级；一条规则对应一个原生标签页分组。同一规则的多个匹配路径按“任一命中”处理。
- `rules: []` 合法，表示没有分组规则；每个已存在的规则必须至少有一条非空匹配路径。
- 表中的“默认”表示字段缺省时的行为或规范化结果，读取 / 校验并不一定把所有默认值写回 JSON。显式 `null` 不等同于省略字段。
- 日志、手动拖入后的待确认项、配置页选中项和卡片展开状态不属于配置文件。`rules[].collapsed` 控制浏览器分组的自动折叠，不是配置页卡片的折叠状态。

## 公共结构

### 分组规则 `rules[]`

除 `strictMode` 为当前 v1.3.0 新增可选字段外，下列字段在两个格式中共用。

| 字段 | 类型 | 必填 | 默认 / 约束 |
|---|---|---|---|
| `id` | string | 是 | 非空，同一文件内唯一；作为稳定标识，不应随分组改名变化 |
| `name` | string | 是 | 非空；v1.2.0 起保存 / 替换导入时要求去除首尾空白后的名称唯一 |
| `patterns` | string[] | 是 | 非空数组，每项为非空 URL 通配模式；不是正则表达式 |
| `enabled` | boolean | 否 | `true`；`false` 时该规则不参与匹配 |
| `color` | string | 否 | `grey`，可选值见下文 |
| `collapsed` | boolean | 否 | `false`；具体折叠行为见各版本说明 |
| `minTabs` | integer | 否 | `1`，必须 ≥ 1；同一窗口命中数量达到阈值才归组 |
| `note` | string | 否 | 空字符串，仅作为备注 |
| `highlight` | object | 否 | 页面内标识，缺省关闭，详见下文 |
| `titleRule` | object | 否 | 标签页重命名，缺省关闭；两个版本的内部结构不同 |
| `strictMode` | boolean | 否 | `false`，v1.3.0 新增；导航到不符合当前组匹配路径的网站时移出分组 |

颜色枚举：`grey`、`blue`、`red`、`yellow`、`green`、`pink`、`purple`、`cyan`、`orange`。

分组通过名称复用。v1.0.1 / v1.1.0 只校验 id 唯一，允许名称重复；v1.2.0 起保存和替换导入拒绝重名，但本地配置读取时放宽该检查，避免整份配置回退默认值。新文件应始终保证名称唯一。当前追加导入允许先读取重名规则，再在合并时重命名。

### 匹配路径 `patterns`

匹配完整 URL，仅 `*` 是通配符，其他字符按字面量处理。例如：

| 模式 | 含义 |
|---|---|
| `https://example.com/*` | 指定协议和主机下的全部路径 |
| `*://example.com/*` | HTTP / HTTPS 下该主机的全部路径 |
| `*://*.example.com/*` | 裸域名 `example.com` 及其子域名 |
| `*://localhost:*/*` | 带端口的 localhost 地址；无端口需另加 `*://localhost/*` |

配置页可将域名 / IP 简写扩写为完整模式，但 JSON 字段的校验只检查非空字符串，不保证每项都能命中实际网站。手工编写文件时应使用完整通配模式，不依赖配置页扩写。它与 `titleRule.rules[].urlPattern` 的正则语法不同。

### 页面内标识 `highlight`

| 字段 | 类型 | 默认 / 约束 |
|---|---|---|
| `enabled` | boolean | `false` |
| `border` | object | 边框配置 |
| `border.sides` | string[] | `top`、`right`、`bottom`、`left` 的子集 |
| `border.width` | integer | 默认 `4`，范围 1–24，单位 px |
| `border.opacity` | integer | 默认 `100`，范围 0–100 |
| `banner` | object | 分组名标识配置 |
| `banner.positions` | string[] | `top`、`right`、`bottom`、`left`、`topLeft`、`topRight`、`bottomRight`、`bottomLeft` 的子集 |
| `banner.size` | integer | 默认 `28`，范围 8–160，单位 px |
| `banner.fontSize` | integer | 默认 `14`，范围 8–32，单位 px |
| `banner.opacity` | integer | 默认 `60`，范围 0–100 |

以上字段均可省略。整个 `highlight` 省略时，规范化结果为关闭状态、四边边框和左上角 banner 的默认参数。若显式提供 `highlight` 对象，其内部缺省的 `border.sides` / `banner.positions` 会按空数组处理；因此开启标识时应显式填写需要显示的位置。

当前校验会检查位置数组的元素类型，渲染规范化时过滤未知位置并去重；不要把未知位置当作受支持取值。建议分别填写边框和 banner 的 `opacity`，不要使用早期开发写法 `highlight.opacity`。

## schemaVersion 2：当前格式

### 根字段

| 字段 | 类型 | 必填 | 默认 / 约束 |
|---|---|---|---|
| `schemaVersion` | integer | 是 | 固定为 `2` |
| `rules` | object[] | 是 | 公共分组结构，标题规则使用 schema 2 写法 |
| `clickAction` | string | 否 | `sync`，枚举与 schema 1 相同 |
| `language` | string | 否 | `auto`；`auto` / `zh` / `en` |
| `groupsFirst` | boolean | 否 | `false`，分组前置 |
| `autoUpdateGroupRules` | boolean | 否 | `true`，手动将标签页拖入已有规则的组后，是否提示添加匹配路径 |
| `showActionResult` | boolean | 否 | `true`，是否显示图标快捷操作的结果提示 |

`globalEnabled` 已移除：读取和导入时忽略并删除，即使值为 `false` 也不会暂停插件。规则自身的 `enabled` 保留。

`rules[].strictMode` 为组内独立设置，默认关闭。`rules[].collapsed` 现在表示自动折叠：新建分组或标签页从组外成功进入时，按 `true` 折叠；组内导航 / 刷新不主动折叠，`false` 不会强制展开已有组。

### 重命名规则 `titleRule`

| 字段 | 类型 | 默认 / 约束 |
|---|---|---|
| `enabled` | boolean | `false` |
| `rules` | object[] | `[]`，顺序即优先级，首条命中后停止 |
| `testCases` | object[] | `[]`，每项为 `{ "title": string, "url": string }`，两字段均必填 |
| `rules[].titlePattern` | string | `""`，原标题正则条件 |
| `rules[].urlPattern` | string | `""`，当前完整 URL 的正则条件 |
| `rules[].replacement` | string | `""`，完整新标题模板；空字符串表示将命中标题设为空 |
| `rules[].description` | string | `""`，仅用于说明，不参与匹配 |

#### 条件和匹配边界

- `titlePattern` / `urlPattern` 可单独省略或留空，但每条规则至少填写一个非空条件；两个条件同时填写时必须同时命中。
- 两种条件均按完整值匹配，等价于外层非捕获包装 `^(?:pattern)$`；不改变捕获组编号。实现也排除 `$` 对末尾换行的特殊容许。
- 外层显式的 `^` / `$` 与默认边界等价。配置页在输入框两侧固定显示边界符号；失焦去除冗余边界时保留转义的 `\$`。字段可保存正则主体，也可保存显式边界。
- URL 条件不自动追加 `.*`。如需匹配后续路径、参数或片段，必须在主体中显式表达；条件应包含协议和域名。
- 不支持 `/pattern/i` 这类正则字面量 / 标志位写法；字段存正则源码，按区分大小写的 JavaScript 正则执行。
- `pattern` / `testText` 是 schema 1 字段，出现在 schema 2 标题规则中会被拒绝，不会静默当作新版字段使用。

| URL 正则主体 | 范围 |
|---|---|
| `https://example\.com/hello` | 仅该完整地址 |
| `https://example\.com/hello.*` | 允许任意尾部内容，也会匹配 `/hello-world` |
| `https://example\.com/hello(?:\?[^#]*)?(?:#.*)?` | 允许查询参数 / 片段，不允许额外路径 |

这里的表格展示正则源码；写入 JSON 时，每个反斜杠都要再转义为 `\\`。

#### 完整新标题模板

`replacement` 展开后的内容直接作为完整新标题，不会自动拼回原标题中未被条件匹配的文本。

| 模板 | 含义 |
|---|---|
| `${title.1}` / `${url.1}` | 对应正则的第 1 个捕获组，可使用其他数字编号 |
| `${title.name}` / `${url.name}` | 对应正则的命名捕获组 |
| `${title.0}` / `${url.0}` | 整个标题 / URL；某来源条件留空时也可引用其完整原值 |
| `$$` | 字面量美元符号 `$` |
| `$${url.1}` | 字面量 `${url.1}`，不执行捕获引用 |
| `$1`–`$99`、`$<name>`、`$&` | 兼容标题来源的旧模板语法，不引用 URL |

带来源的捕获引用不存在或未参与匹配时按空字符串处理。捕获结果只展开一次，其中的 `$` 不会再被解释。旧语法仍遵循原生替换的捕获编号回退规则：不存在的编号可能保留字面量；标题完整匹配后，旧匹配前 / 后文本引用为空字符串。

测试用例中的空标题、空 URL 和首尾空格均保留，不再像旧多行测试那样按行 trim / 过滤。URL 测试字段要求字符串，不要求它是可导航的有效地址；例如标题单来源测试可填写空 URL。

### schema 2 完整示例

```json
{
  "schemaVersion": 2,
  "clickAction": "sync",
  "language": "auto",
  "groupsFirst": false,
  "autoUpdateGroupRules": true,
  "showActionResult": true,
  "rules": [
    {
      "id": "work-app",
      "enabled": true,
      "name": "工作",
      "color": "purple",
      "collapsed": false,
      "strictMode": false,
      "minTabs": 1,
      "note": "从 URL 提取工单号",
      "patterns": ["https://example.com/*"],
      "highlight": {
        "enabled": true,
        "border": { "sides": ["top"], "width": 4, "opacity": 100 },
        "banner": { "positions": ["topLeft"], "size": 28, "fontSize": 14, "opacity": 60 }
      },
      "titleRule": {
        "enabled": true,
        "rules": [
          {
            "titlePattern": "(?<app>App)",
            "urlPattern": "https://example\\.com/items/(?<id>[0-9]+)(?:\\?[^#]*)?(?:#.*)?",
            "replacement": "${title.app} · 工单 ${url.id}",
            "description": "工单号与应用名"
          }
        ],
        "testCases": [
          { "title": "App", "url": "https://example.com/items/123?view=detail#info" }
        ]
      }
    }
  ]
}
```

该用例输出：`App · 工单 123`。

## schemaVersion 1：历史正式格式

### 正式发布标签内的兼容变更

同一 schemaVersion 可以增加带缺省行为的可选字段；因此仅知道 `schemaVersion: 1`，不能推断所有历史插件版本都支持其中的每个字段。以下按插件版本倒序记录：

| 发布标签 | 相对前一已核对标签的字段变化 | 缺省及兼容行为 |
|---|---|---|
| `v1.2.0` | 新增根级可选 `clickAction`、`language`；未增加分组、标题规则或页面标识的配置字段 | 旧文件缺省按 `sync` / `auto` 使用，无需提升 schemaVersion；新导出文件带这两个字段 |
| `v1.1.0` | 相对 `v1.0.1` 无字段、类型、默认值或可选性变更 | 存储层、标题规则、页面标识源码均逐字相同，只迁移了文件目录，schemaVersion 继续为 1 |
| `v1.0.1` | 本次核对的最早发布标签；根字段为 `schemaVersion`、`globalEnabled`、`rules` | 已有 `highlight`、`titleRule` 及其可选字段；没有 `clickAction`、`language` 的配置支持 |

`v1.0.1` / `v1.1.0` 的校验不拒绝未知的根字段，因此可以接受含 `clickAction` / `language` 的 schema 1 文件，但不会按它们改变行为；通过旧版配置页重新组装并保存时，这两个字段不会保留。v1.2.0 对这两个字段做枚举校验：缺省合法，提供非法值则拒绝，不能把运行期兜底当作导入容错。

另有不增加字段的校验变化：v1.2.0 新增 `name.trim()` 唯一性检查，保存 / 替换导入时拒绝重名；本地读取允许历史重名。v1.0.1 / v1.1.0 仅对 `id` 做唯一性检查。

核对文件：`v1.0.1:src/store.js` / `src/title-rule.js` / `src/highlight.js`，以及后续标签的 `src/app/store.js` / `src/core/title-rule.js` / `src/core/highlight.js`。未将开发期间未发布的新增字段算作这些正式版本的变化。

### 根字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schemaVersion` | integer | 是 | 固定为 `1` |
| `globalEnabled` | boolean | 是 | 全局启停，默认配置为 `true` |
| `rules` | object[] | 是 | 公共分组结构，标题规则使用 schema 1 写法 |
| `clickAction` | string | 否 | v1.2.0 新增，缺省 `sync`，枚举见下文 |
| `language` | string | 否 | v1.2.0 新增，缺省 `auto`；`auto` / `zh` / `en` |

`clickAction` 枚举及含义：

| 值 | 操作 |
|---|---|
| `sync` | 仅同步分组 |
| `syncRuleCollapse` | 同步后按规则的折叠设置折叠 |
| `syncCollapseInactive` | 同步后折叠不含活动标签页的组 |
| `syncCollapseAll` | 同步后折叠所有组 |

同步覆盖所有窗口，附加的折叠操作只处理点击时所在窗口。历史版本的 `collapsed` 作为目标分组状态应用，可能在规则再次命中时覆盖已有组的展开 / 折叠状态；不要将它等同于 v1.3.0 的自动折叠触发条件。

### 标题规则 `titleRule`

| 字段 | 类型 | 默认 / 约束 |
|---|---|---|
| `enabled` | boolean | `false` |
| `rules` | object[] | `[]`，按顺序取第一条命中的规则 |
| `testText` | string | `""`，多行标题测试文本 |
| `rules[].pattern` | string | 每条规则必填，非空、合法的 JavaScript 正则表达式 |
| `rules[].replacement` | string | `""`，原生正则替换字符串 |
| `rules[].description` | string | `""`，规则描述 |

历史行为：

- 只对原标题匹配，不读取 URL 捕获组；不隐含添加 `^` / `$`。
- 不支持正则标志位，区分大小写，替换首个匹配部分。未被匹配的前后标题文本会保留。
- 支持 `$1`–`$99`、`$<name>`、`$&`、`$$` 以及原生替换中的匹配前 / 后文本引用。
- 测试时按行拆分 `testText`，去除每行首尾空白并跳过空行；原字符串随配置持久化。

### schema 1 完整示例

以下使用 v1.2.0 的字段集合；用于 v1.0.1 / v1.1.0 时可省略 `clickAction` 和 `language`。

```json
{
  "schemaVersion": 1,
  "globalEnabled": true,
  "clickAction": "sync",
  "language": "auto",
  "rules": [
    {
      "id": "work-app",
      "enabled": true,
      "name": "工作",
      "color": "purple",
      "collapsed": false,
      "minTabs": 1,
      "note": "工作系统",
      "patterns": ["https://example.com/*"],
      "highlight": {
        "enabled": true,
        "border": { "sides": ["top"], "width": 4, "opacity": 100 },
        "banner": { "positions": ["topLeft"], "size": 28, "fontSize": 14, "opacity": 60 }
      },
      "titleRule": {
        "enabled": true,
        "rules": [
          {
            "pattern": "^\\[工作\\]\\s*(.*)$",
            "replacement": "W· $1",
            "description": "去掉工作前缀"
          }
        ],
        "testText": "[工作] 项目看板\n[工作] 工单列表"
      }
    }
  ]
}
```

## 读取、迁移和兼容性

### schema 1 → 2

当前版本的本地配置读取、替换导入、追加导入都会执行迁移；不依赖安装 / 升级事件主动改写存储。读到 schema 1 后在内存使用迁移结果，下一次保存写入 schema 2。新导出的配置使用 schema 2。

| 旧字段 / 内容 | 处理 |
|---|---|
| `schemaVersion: 1` | 改为 `2` |
| `titleRule.rules[].pattern` | 改为 `titlePattern`，`urlPattern` 设为空字符串 |
| 旧 `replacement` | 保留旧捕获语法；转义原有字面量 `${title.*}` / `${url.*}`，避免误作新捕获引用 |
| `titleRule.testText` | 按行拆分、trim、跳过空行，转为 `testCases: [{ "title": "...", "url": "" }]`；移除旧字段 |
| `globalEnabled` | 忽略并移除 |
| 新增的可选字段 | 未提供时使用默认行为，不保证立即补入 JSON |

结构迁移不等于旧版重命名行为完全保持：schema 2 要求标题完整匹配，并用模板生成完整新标题。旧版依赖片段匹配或保留未匹配文本的规则，需要改写正则和模板；例如通过 `(.*)` 捕获需要保留的内容，再在模板中引用。

开发过程中的过渡配置可能有根级 `strictMode`，它不属于 v1.2.0 正式字段。当前兼容读取会把布尔值补到未显式设置该字段的规则上，组内显式值优先，随后移除根字段。追加导入忽略所有全局字段，因此不会用文件的根级严格模式覆盖导入规则。

### 替换导入、追加导入和回退

- 替换导入：迁移后校验整份配置，要求分组名称 / id 唯一；通过确认后替换并同步。非法文件不替换当前配置。
- 追加导入：仅读取 `schemaVersion` 和 `rules`，忽略所有全局设置；迁移并校验规则后追加到当前列表，名称冲突使用 `-导入`、`-导入-2` 等后缀，id 冲突重新生成。
- 当前只支持正式 schema 1 的迁移和 schema 2 的直接读取；未知版本拒绝。非法本地配置回退内置默认值并返回错误信息，原存储不会因此自动改写。
- 不提供 schema 2 → 1 的降级转换。旧插件会拒绝 schema 2，回退版本前应保留 schema 1 备份。
- 当前校验不是“拒绝所有未知字段”的严格 JSON Schema 校验；部分额外字段可能保留，配置页保存时也可能被丢弃。手工生成文件请只依赖本文列出的字段。

## 实现和历史依据

- 历史正式格式：Git 标签 `v1.0.1` 的 `src/store.js`、`v1.1.0` 和 `v1.2.0` 的 `src/app/store.js`；历史标题语义见 `v1.2.0:src/core/title-rule.js`。
- 当前配置校验和读写：[src/app/store.js](../src/app/store.js)。
- 迁移：[src/core/config-migration.js](../src/core/config-migration.js)。
- 通配匹配：[src/core/rules.js](../src/core/rules.js)。
- 标题编译和模板：[src/core/title-rule.js](../src/core/title-rule.js)。
- 标识默认值：[src/core/highlight.js](../src/core/highlight.js)。

后续正式发布时保留历史版本章节；新增格式单独增加章节，并更新版本状态、迁移关系和示例。
