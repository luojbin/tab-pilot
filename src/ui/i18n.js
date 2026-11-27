/**
 * TabPilot 配置页文案
 *
 * 语言只影响配置页的展示，不改变规则组名、匹配路径、备注等用户数据。
 * 语言偏好属于配置本身（`config.language`），随保存 / 导入导出。
 */

const EN = {
  '红色': 'Red',
  '绿色': 'Green',
  '粉色': 'Pink',
  '灰色': 'Grey',
  '蓝色': 'Blue',
  '紫罗兰色': 'Violet',
  '黄色': 'Yellow',
  '亮蓝色': 'Light blue',
  '粉红': 'Pink',
  '紫色': 'Purple',
  '青色': 'Cyan',
  '橙色': 'Orange',

  '色彩主题': 'Color themes',
  '复制为自定义主题': 'Copy as custom theme',
  '自定义主题名': 'Custom theme name',
  '点击编辑颜色': 'Click to edit color',
  '[自定义]': '[Custom]',
  '删除自定义主题': 'Delete custom theme',
  '删除当前自定义主题？将恢复浏览器默认主题。': 'Delete this custom theme? The browser default theme will be restored.',
  'customColorThemes 必须是数组': 'customColorThemes must be an array',
  '自定义主题必须有唯一标识、名称和九种有效的十六进制颜色': 'Custom themes must have unique IDs, names, and nine valid hex colors',
  '页内标识主题': 'Page highlight theme',
  'Firefox · 浅色': 'Firefox · Light',
  'Firefox · 深色': 'Firefox · Dark',
  'Chrome · 浅色': 'Chrome · Light',
  'Chrome · 深色': 'Chrome · Dark',
  'Edge · 浅色': 'Edge · Light',
  'Edge · 深色': 'Edge · Dark',
  'Edge 增强对比 · 浅色': 'Edge enhanced contrast · Light',
  'Edge 增强对比 · 深色': 'Edge enhanced contrast · Dark',
  '经典': 'Classic',
  '仅影响页内边框、标识和配置页预览，不改变浏览器标签页群组的颜色。主题明暗由此处固定选择，不随网页或系统主题自动切换。': 'Only affects page borders, banners, and settings previews, not native tab group colors. Light and dark palettes are selected here and do not follow the page or system theme.',
  '增强对比主题以 Edge 色相为基础，其中粉色槽位调整为警示红；经典保留原有配色。原生色板是采样参考，无法保证与所有浏览器主题精确一致。': 'Enhanced contrast uses Edge hues, with the pink slot changed to warning red. Classic preserves the original palette. Native palettes are sampled references and may differ from browser themes.',
  'colorTheme 必须是有效的色彩主题': 'colorTheme must be a valid color theme',

  '标签页重命名': 'Rename tab',
  '弹出动作菜单': 'Show action menu',
  '选择直接执行同步 / 折叠、重命名当前标签页，或打开动作菜单；折叠只影响当前窗口。': 'Sync or collapse groups, rename the active tab, or open an action menu. Collapsing only affects the current window.',

  '规则已删除；页面暂时无法更新，请确认网站访问权限并刷新页面。': 'Rule deleted, but the page could not be updated. Check website access permissions and reload the page.',
  '前往配置页': 'Settings',
  '已保存重命名规则“{title}”。': 'Saved title rule “{title}”.',
  '已删除重命名规则“{title}”。': 'Deleted title rule “{title}”.',
  '已删除重命名规则“{title}”，当前标签页名由全局通配规则控制，如需修改请前往配置页。': 'Deleted title rule “{title}”. The tab title is now controlled by a general global rule. To change it, open settings.',
  '已删除重命名规则“{title}”，当前标签页名由组内规则控制，如需修改请前往配置页。': 'Deleted title rule “{title}”. The tab title is now controlled by a rule group rule. To change it, open settings.',
  '当前标题由全局通配规则生成，请前往插件配置页维护。': 'This title comes from a general global rule. Manage it in extension settings.',
  '当前标题由组内重命名规则生成，请前往插件配置页维护。': 'This title comes from a rule group title rule. Manage it in extension settings.',
  '确认': 'Confirm',
  '重置': 'Reset',
  '无法读取目标页面，请关闭面板后重新操作。': 'Could not read the target page. Close this popup and try again.',
  '页面或规则已变化，请关闭面板后重新操作。': 'The page or rule has changed. Close this popup and try again.',
  '配置已在其他窗口更新，请先放弃修改并重新读取，再进行保存。': 'Config changed in another window. Discard your edits and reload before saving.',
  '全局重命名规则': 'Global title rules',
  '全局标题': 'Global title',
  '此处是全局的标签页名规则，优先于规则组内重命名，不影响页面归属。': 'These are global tab title rules. They take priority over rule group title rules without changing page ownership.',
  '快捷重命名': 'Quick rename',
  '目标标题': 'New title',
  '忽略查询参数': 'Ignore query parameters',
  '保留路径和 hash，仅允许查询参数变化。': 'Keep the path and hash; allow query parameters to vary.',
  '确认重命名': 'Rename',
  '请输入目标标题。': 'Enter a new title.',
  '页面地址已变化，请关闭窗口后重新操作。': 'The page address has changed. Close this window and try again.',
  '规则已保存；页面暂时无法应用，请确认网站访问权限并刷新页面。': 'Rule saved, but it could not be applied. Check website access permissions and reload the page.',
  '无法读取目标页面，请关闭窗口后重新操作。': 'Could not read the target page. Close this window and try again.',

  '新建标签页群组或有标签从组外移入时自动折叠；组内跳转或刷新保持当前状态。': 'Collapse when a group is created or tabs enter from outside. Keep its current state during navigation or reloads within the group.',
  '仅在新建标签页群组或有标签从组外移入时自动折叠，组内跳转不改变折叠状态。': 'Only auto-collapse when creating a group or moving tabs into it. Navigation within the group does not change its collapse state.',
  '新建空白规则': 'New blank rule',
  '基于现有标签页群组创建': 'Create from existing tab groups',
  '当前窗口没有可生成规则组的标签页群组：已有同名规则组，或组内没有可用的网站。': 'No tab groups to create rules from in this window: matching rules already exist, or the groups have no supported websites.',
  '从当前窗口创建规则组失败。': 'Could not create rule groups from this window.',
  '已从当前窗口创建 {count} 个规则组，请保存并同步后生效。': 'Created {count} rule groups from this window. Save and sync to apply them.',

  '拖拽调整规则顺序，保存后生效': 'Drag to reorder rules; save to apply',
  '追加导入…': 'Append import…',
  '仅追加文件中的规则组，保留当前全局设置': 'Append only rule groups from the file and keep current global settings',
  '导出已保存的配置，或选择替换导入、仅追加规则组。': 'Export saved config, replace config on import, or append only rule groups.',
  '追加导入失败，文件中的规则组不合法。': 'Append import failed: invalid rule groups in the file.',
  '文件中没有可追加的规则组。': 'The file has no rule groups to append.',
  '追加导入失败，请先修正当前配置。': 'Append import failed. Fix the current config first.',
  '将文件中的规则组追加到末尾并保存当前配置？文件中的全局设置将被忽略，同名规则组将添加“-导入”后缀。':
    'Append the file’s rule groups at the end and save the current config? Global settings in the file will be ignored. Duplicate names will receive a “-导入” suffix.',
  '追加导入失败，当前配置未改变。': 'Append import failed. Current config has not changed.',
  '追加导入成功，已保存并同步。': 'Append import complete. Config saved and synced.',
  '追加导入已保存，但同步失败，请稍后重试。': 'Appended rule groups saved, but sync failed. Try syncing again later.',
  '追加导入失败。': 'Append import failed.',

  '选择设置页和弹出面板的显示语言，也可跟随浏览器。': 'Choose the language for settings and the popup, or follow your browser.',
  '严格模式': 'Strict mode',
  '页面跳转到不匹配本规则组的网站时，自动移出当前标签页群组。':
    'Automatically remove a tab from this group when it navigates to a website outside this group’s rule.',

  '自动更新规则组匹配规则': 'Prompt to update rule group patterns',
  '操作结果提示': 'Show action results',
  '使用插件图标快捷功能或保存、删除快捷重命名规则后显示操作结果；关闭时执行完成后直接关闭弹出面板。':
    'Show results after toolbar actions or saving and deleting quick title rules. When off, the popup closes as soon as the action completes.',
  '手动将标签页拖入已有规则组的标签页群组时，提示是否添加该网站的匹配规则。':
    'When a tab is manually moved into a group with an existing rule, ask whether to add a match pattern for the website.',

  '是否将该网站加入“{name}”的匹配规则？': 'Add this website to the match patterns for “{name}”?',
  '匹配地址': 'Match pattern',
  '加入规则组': 'Add to rule group',
  '取消': 'Cancel',
  '请输入有效的匹配地址。': 'Enter a valid match pattern.',
  '页面或标签页群组已变化，请关闭后重新操作。': 'The tab or group has changed. Close this popup and try again.',
  '保存失败，请重试。': 'Could not save. Try again.',
  '规则已保存，但同步失败，请稍后重试同步。': 'Rule saved, but sync failed. Try syncing again later.',
  '已加入匹配规则。': 'Match pattern added.',

  'TabPilot 操作': 'TabPilot Actions',
  '设置': 'Settings',
  '正在执行…': 'Working…',
  '无法打开设置，请重试。': 'Could not open settings. Try again.',
  '标签页群组前置': 'Groups first',
  '将标签页群组移到前面，保留各自顺序；手动新建或改名后，点击页面或切换标签时再整理。':
    'Move groups to the front while preserving their order. After manually creating or renaming a group, click the page or switch tabs to arrange it.',
  '复制': 'Duplicate',
  '副本': 'Copy',
  '复制、调整顺序或删除': 'Duplicate, reorder or delete',
  '已复制到末尾：请按需修改匹配路径，并启用后保存。':
    'Group duplicated at the end. Adjust match patterns as needed, enable it, then save.',

  // 页面框架
  'TabPilot 设置': 'TabPilot Settings',
  '启用自动归组': 'Enable auto-grouping',
  '保存并同步': 'Save & sync',
  '放弃修改': 'Discard changes',
  '恢复默认': 'Restore defaults',
  '导出 JSON': 'Export JSON',
  '导入 JSON…': 'Import JSON…',
  '添加规则组': 'Add rule group',
  '把已保存的配置导出为 JSON 文件':
    'Export the saved config as a JSON file',
  '从 JSON 文件导入配置，校验通过后替换当前配置并同步':
    'Import config from JSON, then replace current config and sync after validation',
  '全局配置': 'Global settings',
  '语言': 'Language',
  '自动（跟随浏览器）': 'Auto (follow browser)',
  '中文': '中文',
  'English': 'English',
  '配置备份': 'Backup',
  '配置管理': 'Config management',
  '全局选项': 'Global options',
  '点击插件图标': 'Icon click behavior',
  '仅同步（检查未归组的标签）': 'Sync only (check for ungrouped tabs)',
  '同步并按规则折叠标签页群组': 'Sync and collapse groups by rule',
  '同步并折叠非活动标签页群组': 'Sync and collapse inactive groups',
  '同步并折叠所有标签页群组': 'Sync and collapse all groups',
  '点图标时先同步，再按所选方式折叠标签页群组；折叠只影响点击时所在的窗口。':
    'On click: sync first, then collapse as selected; collapsing only affects the window you clicked in.',
  '导出已保存的配置，或从 JSON 文件导入并替换配置。':
    'Export the saved config, or import and replace it from a JSON file.',
  '有未保存的修改，请先「保存并同步」或「放弃修改」再导出。':
    'You have unsaved changes. Save or discard them before exporting.',
  '删除已保存的配置，回到内置默认规则':
    'Delete the saved config and restore the built-in defaults',
  '以后可以在这里增加更多全局选项。':
    'More global options can be added here later.',

  // 权限提示
  '网站访问权限': 'Site access permission',
  '页面内标识和标签页改名需要「访问所有网站」的权限。':
    'In-page highlights and tab renaming require permission to access all websites.',
  '当前没有该权限，这两项功能不会生效。':
    'This permission is not granted, so these features will not work.',
  '已获得访问所有网站的权限。': 'Permission to access all websites is granted.',
  '没有访问网站的权限，页面内标识不会生效。请到全局配置中按提示申请权限。':
    'No permission to access websites; in-page highlights will not be applied. Request the permission from Global settings.',
  '没有访问网站的权限，标签页标题不会被改写。请到全局配置中按提示申请权限。':
    'No permission to access websites; tab titles will not be rewritten. Request the permission from Global settings.',
  '申请授权': 'Request permission',
  '取消授权': 'Revoke permission',
  '已获得访问网站的权限，请刷新已打开的页面让页面内标识生效':
    'Permission granted. Reload open pages so in-page highlights take effect.',
  '未获得访问网站的权限，页面内标识和标签页改名暂时不会生效':
    'Permission not granted. In-page highlights and tab renaming stay disabled for now.',
  '已撤销访问网站的权限，页面内标识和标签页改名将停用（刷新已打开的页面后完全停止）':
    'Permission revoked. In-page highlights and tab renaming are disabled (fully after reloading open pages).',
  '访问网站的权限未被撤销': 'Permission to access websites was not revoked.',
  '顶部「全局配置」管理语言和配置导入导出；下方规则组列表用于选中规则组，重命名、改颜色、启用 / 停用在右侧完成。可拖拽调整顺序；操作菜单可以复制、调整顺序或删除。':
    'The top "Global settings" item manages language and config import/export. The rule group list below selects rule groups; rename, recolor, enable/disable on the right. Drag to reorder. Use the actions menu to duplicate, reorder or delete.',

  // 左栏 / 规则组列表
  '规则组': 'Rule groups',
  '还没有规则组，点右上角 ＋ 添加。': 'No rule groups yet. Click + in the top right to add one.',
  '未命名规则组': 'Untitled rule group',
  '已停用（在右侧启用）': 'Disabled (enable on the right)',
  '已启用（在右侧停用）': 'Enabled (disable on the right)',
  '调整顺序或删除': 'Reorder or delete',
  '规则组操作菜单': 'Rule group actions menu',
  '↑ 上移': '↑ Move up',
  '↓ 下移': '↓ Move down',
  '✕ 删除': '✕ Delete',
  '新规则组': 'New rule group',
  '左栏只用于查看和选中规则组；重命名、改颜色、启用 / 停用在右侧完成。可拖拽调整顺序；操作菜单可以复制、调整顺序或删除。':
    'The left column is for viewing and selecting rule groups. Rename, recolor, enable/disable on the right. Drag to reorder. Use the actions menu to duplicate, reorder or delete.',
  '左侧还没有规则组。点「＋」新建一个规则组，再把要匹配的地址填进来。':
    'No rule groups on the left. Click + to create one, then add the address to match.',
  '从左侧选择一个规则组，查看并编辑它的详细配置。':
    'Select a rule group on the left to view and edit its settings.',
  '规则组详情': 'Rule group details',
  '第 {n} 个 · 顺序即优先级': 'Rule group {n} · order = priority',

  // 基础配置
  '基础配置': 'Basic settings',
  '规则组名': 'Rule group name',
  '例如「开发」': 'e.g. Development',
  '颜色': 'Color',
  '阈值': 'Threshold',
  '同一窗口内命中该规则组的标签数达到该值才归组（1 = 立刻归组）':
    'Group when this many tabs in the window match (1 = group immediately)',
  '标签页群组阈值': 'Group threshold',
  '备注': 'Notes',
  '可选，例如「开发环境」': 'Optional, e.g. Development environment',
  '启用': 'Enabled',
  '启用该规则组': 'Enable this rule group',
  '自动折叠': 'Auto-collapse',
  '自动折叠该标签页群组': 'Auto-collapse this group',
  '匹配路径': 'Match patterns',
  '匹配路径 {n}': 'Match pattern {n}',
  '每条规则至少保留一条匹配路径': 'Each rule needs at least one match pattern',
  '删除这条匹配路径': 'Delete this match pattern',
  '＋ 添加匹配路径': '+ Add match pattern',
  '192.168.0.123 或 *://localhost:*/*': '192.168.0.123 or *://localhost:*/*',
  '可以只写域名或 IP：离开输入框或保存时会自动补全——不带协议按 http/https 匹配；没有路径时同时匹配任意端口与无端口；结尾自动补 /*。':
    'You can enter just a domain or IP: it will be completed on blur or save — no scheme matches http/https, no path matches any port and no port, and /* is appended automatically.',

  // 页面内标识
  '页面内突出显示': 'In-page highlight',
  '页面内突出显示：已启用': 'In-page highlight: on',
  '页面内突出显示：未启用': 'In-page highlight: off',
  '在该规则组的页面上显示标识': 'Show highlight on pages in this rule group',
  '边框（颜色取自该规则组）': 'Border (color from this rule group)',
  '宽度 px': 'Width px',
  '不透明度 %': 'Opacity %',
  'Banner（显示规则组名，四个角为斜向）':
    'Banner (shows rule group name; corners are diagonal)',
  '尺寸 px': 'Size px',
  '字号 px': 'Font size px',
  '页面预览（示意）': 'Page preview (illustrative)',
  '标识已关闭': 'Highlight is off',
  '上': 'Top',
  '右': 'Right',
  '下': 'Bottom',
  '左': 'Left',
  '左上': 'Top left',
  '右上': 'Top right',
  '右下': 'Bottom right',
  '左下': 'Bottom left',

  '上移': 'Move up',
  '删除': 'Delete',
  '添加匹配路径': 'Add match pattern',
  '添加命名规则': 'Add title rule',
  '添加测试用例': 'Add test case',

  '标签页群组': 'Browser tab group',
  '标签页群组：已启用': 'Browser tab group: on',
  '标签页群组：未启用': 'Browser tab group: off',
  '是否需要创建标签页群组': 'Whether to create browser tab groups',
  '窗口内符合规则的标签页数达到阈值才创建群组': 'Create a group only when the number of matching tabs in the window reaches the threshold',

  // 标签页名规则
  '命名规则必须是对象': 'The title rule must be an object',
  '标题条件和 URL 条件至少填写一个正则': 'Enter at least one title or URL regular expression',
  'pattern 已改为 titlePattern/urlPattern': 'Use titlePattern/urlPattern instead of pattern',
  '描述': 'Description',
  '展开全部规则': 'Expand all rules',
  '折叠全部规则': 'Collapse all rules',
  '未命名规则': 'Untitled rule',
  '展开重命名规则': 'Expand title rule',
  '折叠重命名规则': 'Collapse title rule',
  '标题条件': 'Title condition',
  'URL 条件': 'URL condition',
  '目标文本': 'Replacement',
  '正则表达式，可留空': 'Regular expression, optional',
  '正则主体，留空表示不限制': 'Regex body; leave empty for no restriction',
  '留空表示不限制；如需匹配后续路径、参数等变体，请加 .*': 'Leave empty for no restriction; add .* to match trailing paths, parameters, or other variants',
  '支持 ${title.1}、${url.1} 等捕获组': 'Supports captures such as ${title.1} and ${url.1}',
  '规则{index}': 'Rule {index}',
  '全局规则{index}': 'Global rule {index}',
  '未匹配当前组': 'Does not match this rule group',
  '未匹配': 'No match',
  '正则有误': 'Invalid regex',
  "标题条件（正则，可留空）": "Title condition (regex, optional)",
  "URL 条件（正则，可留空）": "URL condition (regex, optional)",
  "目标文本（支持标题和 URL 捕获组）": "Replacement (title and URL capture groups)",
  "测试用例（每条填写标题和 URL）": "Test cases (title and URL per case)",
  "标题": "Title",
  "URL": "URL",
  "删除测试用例": "Delete test case",
  "＋ 添加测试用例": "+ Add test case",
  "暂无测试用例，请先添加。": "No test cases. Add one first.",
  "按顺序使用首条命中的规则。标题和 URL 条件至少填写一个，同时填写时须同时命中。用 ${title.1}、${url.1} 引用捕获组，命名组用 ${title.name}、${url.name}；$$ 表示美元符号。目标文本是完整的新标题。标题和 URL 条件均默认完整匹配，无需填写 ^ 和 $；如需匹配后续路径、参数等变体，请显式添加 .*。": "Use the first matching rule. Enter at least one condition; both must match when provided. Use ${title.1} and ${url.1} for captures, or ${title.name} and ${url.name} for named captures; $$ inserts a dollar sign. The replacement is the complete new title. Both title and URL conditions match the entire value. No ^ or $ is needed. Explicitly add .* to allow trailing paths, parameters, or other variants.",
  '标签页名规则': 'Tab title rules',
  '标签页名规则：已启用': 'Tab title rules: on',
  '标签页名规则：未启用': 'Tab title rules: off',
  '按顺序匹配并改写标签页标题': 'Match and rewrite tab titles in order',
  '还没有命名规则，点下方按钮添加。': 'No title rules yet. Add one with the button below.',
  '＋ 添加命名规则': '+ Add title rule',
  '描述（可选，例如：Jira 标题）': 'Description (optional, e.g. Jira title)',
  '上移（靠前的规则先匹配）': 'Move up (earlier rules match first)',
  '下移': 'Move down',
  '删除这条命名规则': 'Delete this title rule',
  '源文本（正则表达式）': 'Source (regular expression)',
  '测试文本（每行一个标题）': 'Test text (one title per line)',
  '查看效果': 'Preview',
  '正则有误，未应用': 'Invalid regex; not applied',
  '未匹配，保持原样': 'No match; unchanged',
  '测试文本为空，先输入几行标题。': 'Test text is empty. Enter a few titles first.',
  '规划中': 'Planned',

  // 状态与提示
  '保存失败，请修正以下问题：': 'Save failed. Fix the following:',
  '导入失败，请修正以下问题：': 'Import failed. Fix the following:',
  '保存': 'Save',
  '导入': 'Import',
  '保存成功': 'Saved',
  '导入成功': 'Imported',
  '已取消导入': 'Import cancelled',
  '删除自定义配置并恢复内置默认规则？':
    'Delete custom config and restore built-in default rules?',
  '已恢复默认配置，并同步了已打开的标签页':
    'Restored defaults and synced open tabs.',
  '存储中的配置校验失败，已回退到内置默认配置：':
    'Stored config failed validation; fell back to built-in defaults:',
  '配置已保存，但同步已打开的标签页失败：':
    'Saved, but syncing open tabs failed: ',

  // 颜色
  '灰': 'Grey',
  '蓝': 'Blue',
  '红': 'Red',
  '黄': 'Yellow',
  '绿': 'Green',
  '粉': 'Pink',
  '紫': 'Purple',
  '青': 'Cyan',
  '橙': 'Orange',
  '规则组颜色': 'Rule group color',
  '测试文本示例': 'Test text example',
  '[工作] Jira - 看板\n[代码] GitHub - Pull requests\n普通页面标题': '[Work] Jira - Board\n[Code] GitHub - Pull requests\nNormal page title'
};

const PATTERNS = [
  [/^全局重命名规则的第 (\d+) 条命名规则：([\s\S]+)$/,
    (match, entry, reason) => `Global title rule ${entry}: ${translateText(reason)}`],

  [/^规则组“([\s\S]*)”的第 (\d+) 条命名规则：([\s\S]+)$/,
    (match, name, entry, reason) => `Rule group “${name}”, title rule ${entry}: ${translateText(reason)}`],
  [/^第 (\d+) 个规则组的第 (\d+) 条命名规则：(.+)$/,
    (match, group, entry, reason) => `Rule group ${group}, title rule ${entry}: ${translateText(reason)}`],
  [/^(标题条件|URL 条件)不是合法的正则：(.+)$/,
    (match, field, reason) => `${translateExact(field)} is not a valid regex: ${reason}`],
  [/^(标题条件|URL 条件|目标文本|描述)必须是字符串$/,
    (match, field) => `${translateExact(field)} must be a string`],
  [/^第 (\d+) 个 · 顺序即优先级$/, 'Rule group $1 · order = priority'],
  [/^新规则组 (\d+)$/, 'New rule group $1'],
  [/^匹配路径 (\d+)$/, 'Match pattern $1'],
  [/^保存成功，共 (\d+) 个规则组$/, 'Saved: $1 rule groups'],
  [/^导入成功，共 (\d+) 个规则组$/, 'Imported: $1 rule groups'],
  [
    /^保存成功，共 (\d+) 个规则组；同步完成：归组 (\d+) 个，跳过 (\d+) 个，失败 (\d+) 个$/,
    'Saved: $1 rule groups; sync done: $2 grouped, $3 skipped, $4 failed'
  ],
  [
    /^导入成功，共 (\d+) 个规则组；同步完成：归组 (\d+) 个，跳过 (\d+) 个，失败 (\d+) 个$/,
    'Imported: $1 rule groups; sync done: $2 grouped, $3 skipped, $4 failed'
  ],
  [/^已导出 (\d+) 个规则组到 (.+)$/, 'Exported $1 rule groups to $2'],
  [
    /^导入失败：(.+) 不是合法的 TabPilot 配置$/,
    'Import failed: $1 is not a valid TabPilot config'
  ],
  [
    /^配置已保存，但同步已打开的标签页失败：(.+)$/,
    'Saved, but syncing open tabs failed: $1'
  ],
  [/^保存失败：(.+)$/, 'Save failed: $1'],
  [/^读取失败：(.+)$/, 'Load failed: $1'],
  [/^恢复默认失败：(.+)$/, 'Restore failed: $1'],
  [/^权限请求失败：(.+)$/, 'Permission request failed: $1'],
  [/^撤销权限失败：(.+)$/, 'Permission revoke failed: $1'],
  [/^读取文件失败：(.+)$/, 'Failed to read file: $1'],
  [/^读取配置失败：(.+)$/, 'Failed to load config: $1'],
  [
    /^当前配置：来自 storage，共 (\d+) 个规则组$/,
    'Current config: from storage, $1 rule groups'
  ],
  [
    /^当前配置：内置默认，共 (\d+) 个规则组$/,
    'Current config: built-in defaults, $1 rule groups'
  ],
  [
    /^用导入的配置替换当前配置？\n\n来源：(.+)\n规则组数：(\d+)$/,
    'Replace the current config with the imported one?\n\nSource: $1\nRule groups: $2'
  ],
  [
    /^(.+)失败，请修正以下问题：$/,
    (match, label) => `${translateExact(label)} failed. Fix the following:`
  ],
  [/^配置必须是一个对象$/, 'Config must be an object'],
  [/^配置内容为空$/, 'Config is empty'],
  [/^rules 必须是数组$/, 'rules must be an array'],
  [
    /^schemaVersion 必须为 (\d+)，收到 (.+)$/,
    'schemaVersion must be $1, got $2'
  ],
  [/^clickAction 必须是 (.+) 之一$/, 'clickAction must be one of $1'],
  [/^language 必须是 (.+) 之一$/, 'language must be one of $1'],
  [
    /^(.+) 必须是 (\d+)~(\d+) 的整数$/,
    '$1 must be an integer between $2 and $3'
  ],
  [/^(.+)\.patterns 必须是非空数组（至少一个匹配路径）$/, '$1.patterns must be a non-empty array (at least one match pattern)'],
  [/^(.+)\.patterns\[(\d+)\] 必须是非空字符串$/, '$1.patterns[$2] must be a non-empty string'],
  [/^(.+)\.pattern 不是合法的正则：(.+)$/, '$1.pattern is not a valid regex: $2'],
  [/^(.+)\.id 重复：(.+)$/, '$1.id is duplicated: $2'],
  [/^(.+)\.name 重复：(.+)（与 (.+) 同名）$/, '$1.name is duplicated: $2 (same as $3)'],
  [/^(.+)\.(id|name) 必须是非空字符串$/, '$1.$2 must be a non-empty string'],
  [/^(.+)\.color 必须是 (.+) 之一$/, '$1.color must be one of $2'],
  [/^(.+)\.minTabs 必须是 >= 1 的整数$/, '$1.minTabs must be an integer >= 1'],
  [/^(.+) 只能包含字符串$/, '$1 may only contain strings'],
  [/^(.+) 必须是字符串$/, '$1 must be a string'],
  [/^(.+) 必须是布尔值$/, '$1 must be a boolean'],
  [/^(.+) 必须是数组$/, '$1 must be an array'],
  [/^(.+) 必须是对象$/, '$1 must be an object'],
  [/^JSON 语法错误：(.+)$/, 'JSON syntax error: $1']
];

let language = 'zh';

const textOriginals = new WeakMap();
const attributeOriginals = new WeakMap();

function translateExact(text) {
  return EN[text] !== undefined ? EN[text] : text;
}

function translateText(text) {
  if (language !== 'en') return text;
  const trimmed = text.trim();
  if (trimmed === '') return text;

  const normalized = trimmed.replace(/\s+/g, ' ');
  let translated = EN[trimmed] !== undefined ? EN[trimmed] : EN[normalized];
  if (translated === undefined) {
    for (const [pattern, replacement] of PATTERNS) {
      if (!pattern.test(trimmed)) continue;
      translated = trimmed.replace(pattern, replacement);
      break;
    }
  }
  if (translated === undefined) return text;

  const leading = text.match(/^\s*/)[0];
  const trailing = text.match(/\s*$/)[0];
  return `${leading}${translated}${trailing}`;
}

export function resolveLanguage(preference) {
  if (preference === 'zh' || preference === 'en') return preference;
  let code = '';
  try {
    const api = globalThis.browser || globalThis.chrome;
    code = (api && api.i18n && api.i18n.getUILanguage
      ? api.i18n.getUILanguage()
      : (typeof navigator !== 'undefined' ? navigator.language : '')) || '';
  } catch (err) {
    code = '';
  }
  return String(code).toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'zh';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }
}

export function getLanguage() {
  return language;
}

/** 对话框等非 DOM 文本用这个。 */
export function t(text) {
  return language === 'en' ? translateText(text) : text;
}

function shouldSkipText(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest('script, style, textarea')) return true;
  return Boolean(parent.closest('[data-i18n-skip]'));
}

function translateAttributes(element) {
  if (element.closest('[data-i18n-skip]')) return;
  for (const name of ['title', 'placeholder', 'aria-label']) {
    const value = element.getAttribute(name);
    if (!value) continue;

    let originals = attributeOriginals.get(element);
    if (!originals) {
      originals = {};
      attributeOriginals.set(element, originals);
    }
    if (originals[name] === undefined) originals[name] = value;

    const original = originals[name];
    const next = language === 'en' ? translateText(original) : original;
    if (next !== value) element.setAttribute(name, next);
  }
}

/** 把当前文档（或子树）里的 UI 文案按当前语言重写；用户数据节点加 data-i18n-skip。 */
export function applyI18n(root) {
  const scope = root || document;
  if (!scope || typeof document === 'undefined') return;

  if (scope.querySelectorAll) {
    scope.querySelectorAll('[title], [placeholder], [aria-label]').forEach(translateAttributes);
  }

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    if (shouldSkipText(node)) continue;
    const original = textOriginals.get(node) !== undefined
      ? textOriginals.get(node)
      : node.nodeValue;
    textOriginals.set(node, original);
    const next = language === 'en' ? translateText(original) : original;
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}
