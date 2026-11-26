import { TOOLBAR_ACTIONS } from '../core/toolbar-actions.js';
import browser from '../platform/browser.js';
import { migrateConfig } from '../core/config-migration.js';
import { normalizeTabGroup } from '../core/tab-group.js';
import { compilePattern } from '../core/title-rule.js';

/**
 * TabPilot 存储层
 *
 * 唯一负责读写 browser.storage.local 的地方；所有配置读取都从这里走，
 * 以后换 IndexedDB / 同步存储只改本文件。
 *
 * 配置结构（schemaVersion 2，兼容迁移正式 schema 1）：
 *   { schemaVersion, rules: [rule] }
 *   rule = { id, enabled, name, color, tabGroup{...}, note, patterns[],
 *            highlight{...}, titleRule{...} }
 * 一条规则对应一个标签页分组，`patterns` 里可以有多个匹配路径，
 * 规则在数组中的顺序就是优先级（越靠前越高）。
 *
 * 说明：正式 schema 1 直接迁移至 2；早期开发格式不提供迁移，
 * 与当前编号相同的旧开发数据仍必须通过当前字段校验。
 */
const CONFIG_KEY = 'tabpilot:config';
const SCHEMA_VERSION = 2;

/** Firefox tabGroups 的预设颜色。 */
const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
];

const DEFAULT_COLOR = 'grey';
const DEFAULT_MIN_TABS = 1;

/**
 * 点击工具栏图标的行为：
 *   sync                  仅同步（默认，也是 v1.2.0 之前的行为）
 *   syncRuleCollapse      同步后按规则里的「自动折叠」折叠分组
 *   syncCollapseInactive  同步后折叠不含活动标签的分组
 *   syncCollapseAll       同步后折叠所有分组
 *   renameTab             打开活动标签页的快捷重命名表单
 *   actionMenu            打开动作菜单，选择其余行为
 * 折叠只影响点击时所在的窗口。
 */
const CLICK_ACTIONS = TOOLBAR_ACTIONS.map(([value]) => value);
const DEFAULT_CLICK_ACTION = 'sync';

/** 配置页语言：auto 跟随浏览器，zh 中文，en English。 */
const LANGUAGES = ['auto', 'zh', 'en'];
const DEFAULT_LANGUAGE = 'auto';

/** 分组颜色的实际色值（页面内标识需要真实颜色，不是色名）。 */
const GROUP_COLOR_HEX = {
  grey: '#9aa0a6',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#e8710a'
};

/**
 * 内置默认配置：没有存储配置时的兜底，也是配置页的初始内容。
 */
const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  clickAction: DEFAULT_CLICK_ACTION,
  groupsFirst: false,
  autoUpdateGroupRules: true,
  showActionResult: true,
  language: DEFAULT_LANGUAGE,
  rules: [
    {
      id: 'dev-localhost',
      enabled: true,
      name: '开发',
      color: 'green',
      tabGroup: { enabled: true, minTabs: 1, collapsed: false, strictMode: false },
      note: '本地开发环境',
      patterns: ['*://localhost:*/*'],
      highlight: {
        enabled: false,
        border: { sides: ['top', 'right', 'bottom', 'left'], width: 4, opacity: 100 },
        banner: { positions: ['topLeft'], size: 28, fontSize: 14, opacity: 60 }
      },
      titleRule: {
        enabled: false,
        rules: [],
        testCases: []
      }
    }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkInteger(value, min, max, path, report) {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.floor(value) !== value ||
    value < min ||
    value > max
  ) {
    report(`${path} 必须是 ${min}~${max} 的整数`);
  }
}

/** 组内和全局共用的双来源重命名校验。 */
function validateTitleRule(titleRule, at, groupLabel, report) {
  if (!isPlainObject(titleRule)) {
    report(`${at} 必须是对象`);
    return;
  }
  if (titleRule.enabled !== undefined && typeof titleRule.enabled !== 'boolean') {
    report(`${at}.enabled 必须是布尔值`);
  }
  if ('testText' in titleRule) report(`${at}.testText 已改为 testCases`);
  if (titleRule.testCases !== undefined) {
    if (!Array.isArray(titleRule.testCases)) report(`${at}.testCases 必须是数组`);
    else titleRule.testCases.forEach((row, index) => {
      if (!isPlainObject(row) || typeof row.title !== 'string' || typeof row.url !== 'string') {
        report(`${at}.testCases[${index}] 必须包含 title 和 url 字符串`);
      }
    });
  }
  if (titleRule.rules !== undefined) {
    if (!Array.isArray(titleRule.rules)) {
      report(`${at}.rules 必须是数组`);
    } else {
      titleRule.rules.forEach((entry, entryIndex) => {
        const entryAt = `${at}.rules[${entryIndex}]`;
        const label = `${groupLabel}的第 ${entryIndex + 1} 条命名规则`;
        const entryError = (reason, field) => report(`${label}：${reason}`, {
          entryIndex, path: field ? `${entryAt}.${field}` : entryAt
        });
        if (!isPlainObject(entry)) {
          entryError('命名规则必须是对象');
          return;
        }
        if ('pattern' in entry) entryError('pattern 已改为 titlePattern/urlPattern', 'pattern');
        const names = { titlePattern: '标题条件', urlPattern: 'URL 条件' };
        for (const field of ['titlePattern', 'urlPattern']) {
          if (entry[field] !== undefined && typeof entry[field] !== 'string') entryError(`${names[field]}必须是字符串`, field);
          else if (typeof entry[field] === 'string' && entry[field].trim()) {
            try { compilePattern(entry[field]); }
            catch (err) { entryError(`${names[field]}不是合法的正则：${err.message || err}`, field); }
          }
        }
        if (!(typeof entry.titlePattern === 'string' && entry.titlePattern.trim()) &&
            !(typeof entry.urlPattern === 'string' && entry.urlPattern.trim())) {
          entryError('标题条件和 URL 条件至少填写一个正则');
        }
        if (entry.replacement !== undefined && typeof entry.replacement !== 'string') entryError('目标文本必须是字符串', 'replacement');
        if (entry.description !== undefined && typeof entry.description !== 'string') entryError('描述必须是字符串', 'description');
      });
    }
  }
}

/**
 * 校验配置对象。返回 { ok: true, config } 或 { ok: false, errors: string[], errorDetails: object[] }。
 * 错误提供展示文案和结构化位置；命名规则文案显示规则组名和从 1 开始的条目序号。
 *
 * @param {object} raw 待校验配置
 * @param {{allowDuplicateNames?: boolean}} [options] 仅供 loadConfig 放宽重名校验：
 *   历史配置里可能已经存在同名分组，读取时放行以免整份配置回退默认值；
 *   保存与导入仍然严格拒绝。
 */
function validateConfig(raw, options) {
  raw = migrateConfig(raw);
  const errors = [];
  const errorDetails = [];
  let ruleIndex;
  const report = (message, details = {}) => {
    errors.push(message);
    errorDetails.push({ message, ...(ruleIndex === undefined ? {} : { ruleIndex }), ...details });
  };
  const opts = options || {};

  if (!isPlainObject(raw)) {
    report('配置必须是一个对象');
    return { ok: false, errors, errorDetails };
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    report(
      `schemaVersion 必须为 ${SCHEMA_VERSION}，收到 ${JSON.stringify(raw.schemaVersion)}`
    );
  }
  if ('strictMode' in raw) report('strictMode 已移至 rules[].tabGroup.strictMode');
  for (const key of ['autoUpdateGroupRules', 'showActionResult']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') {
      report(`${key} 必须是布尔值`);
    }
  }
  if (raw.groupsFirst !== undefined && typeof raw.groupsFirst !== 'boolean') {
    report('groupsFirst 必须是布尔值');
  }
  if (raw.clickAction !== undefined && !CLICK_ACTIONS.includes(raw.clickAction)) {
    report(`clickAction 必须是 ${CLICK_ACTIONS.join('/')} 之一`);
  }
  if (raw.language !== undefined && !LANGUAGES.includes(raw.language)) {
    report(`language 必须是 ${LANGUAGES.join('/')} 之一`);
  }
  if (!Array.isArray(raw.rules)) {
    report('rules 必须是数组');
    return { ok: false, errors, errorDetails };
  }

  if (raw.globalTitleRule !== undefined) {
    validateTitleRule(raw.globalTitleRule, 'globalTitleRule', '全局重命名规则',
      (message, details = {}) => report(message, { path: 'globalTitleRule', ...details }));
  }

  const seenIds = new Set();
  // 同名分组会在浏览器里落到同一个原生分组（actions.js 按分组标题复用），
  // 颜色 / 折叠会互相覆盖，因此保存与导入时拒绝重名；比较用 trim 后的名字。
  const seenNames = new Map();
  raw.rules.forEach((rule, index) => {
    ruleIndex = index;
    const where = `rules[${index}]`;
    if (!isPlainObject(rule)) {
      report(`${where} 必须是对象`);
      return;
    }

    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      report(`${where}.id 必须是非空字符串`);
    } else if (seenIds.has(rule.id)) {
      report(`${where}.id 重复：${rule.id}`);
    } else {
      seenIds.add(rule.id);
    }

    if (typeof rule.name !== 'string' || rule.name.trim() === '') {
      report(`${where}.name 必须是非空字符串`);
    }
    const trimmedName = typeof rule.name === 'string' ? rule.name.trim() : '';
    if (trimmedName !== '') {
      const firstIndex = seenNames.get(trimmedName);
      if (firstIndex === undefined) {
        seenNames.set(trimmedName, index);
      } else if (opts.allowDuplicateNames !== true) {
        // 只报后面那条：配置页据此高亮需要改名的分组
        report(`${where}.name 重复：${trimmedName}（与 rules[${firstIndex}] 同名）`, { relatedRuleIndexes: [firstIndex] });
      }
    }
    if (rule.color !== undefined && !GROUP_COLORS.includes(rule.color)) {
      report(`${where}.color 必须是 ${GROUP_COLORS.join('/')} 之一`);
    }
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      report(`${where}.enabled 必须是布尔值`);
    }
    for (const field of ['minTabs', 'collapsed', 'strictMode']) {
      if (field in rule) report(`${where}.${field} 已移至 tabGroup.${field}`);
    }
    if (rule.tabGroup !== undefined) {
      if (!isPlainObject(rule.tabGroup)) report(`${where}.tabGroup 必须是对象`);
      else {
        for (const field of ['enabled', 'collapsed', 'strictMode']) {
          if (rule.tabGroup[field] !== undefined && typeof rule.tabGroup[field] !== 'boolean') report(`${where}.tabGroup.${field} 必须是布尔值`);
        }
        if (rule.tabGroup.minTabs !== undefined && (!Number.isInteger(rule.tabGroup.minTabs) || rule.tabGroup.minTabs < 1)) report(`${where}.tabGroup.minTabs 必须是 >= 1 的整数`);
      }
    }
    if (rule.note !== undefined && typeof rule.note !== 'string') {
      report(`${where}.note 必须是字符串`);
    }
    if (rule.titleRule !== undefined) {
      const label = typeof rule.name === 'string' && rule.name.trim()
        ? `规则组“${rule.name}”` : `第 ${ruleIndex + 1} 个规则组`;
      validateTitleRule(rule.titleRule, `${where}.titleRule`, label, report);
    }

    if (rule.highlight !== undefined) {
      const at = `${where}.highlight`;
      if (!isPlainObject(rule.highlight)) {
        report(`${at} 必须是对象`);
      } else {
        const highlight = rule.highlight;

        if (highlight.enabled !== undefined && typeof highlight.enabled !== 'boolean') {
          report(`${at}.enabled 必须是布尔值`);
        }

        if (highlight.border !== undefined) {
          if (!isPlainObject(highlight.border)) {
            report(`${at}.border 必须是对象`);
          } else {
            if (highlight.border.sides !== undefined) {
              if (!Array.isArray(highlight.border.sides)) {
                report(`${at}.border.sides 必须是数组`);
              } else if (highlight.border.sides.some((side) => typeof side !== 'string')) {
                report(`${at}.border.sides 只能包含字符串`);
              }
            }
            checkInteger(highlight.border.width, 1, 24, `${at}.border.width`, report);
            checkInteger(highlight.border.opacity, 0, 100, `${at}.border.opacity`, report);
          }
        }

        if (highlight.banner !== undefined) {
          if (!isPlainObject(highlight.banner)) {
            report(`${at}.banner 必须是对象`);
          } else {
            if (highlight.banner.positions !== undefined) {
              if (!Array.isArray(highlight.banner.positions)) {
                report(`${at}.banner.positions 必须是数组`);
              } else if (highlight.banner.positions.some((item) => typeof item !== 'string')) {
                report(`${at}.banner.positions 只能包含字符串`);
              }
            }
            checkInteger(highlight.banner.size, 8, 160, `${at}.banner.size`, report);
            checkInteger(highlight.banner.fontSize, 8, 32, `${at}.banner.fontSize`, report);
            checkInteger(highlight.banner.opacity, 0, 100, `${at}.banner.opacity`, report);
          }
        }
      }
    }

    if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
      report(`${where}.patterns 必须是非空数组（至少一个匹配路径）`);
      return;
    }
    rule.patterns.forEach((pattern, patternIndex) => {
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        report(`${where}.patterns[${patternIndex}] 必须是非空字符串`);
      }
    });
  });

  if (errors.length > 0) return { ok: false, errors, errorDetails };
  // 兼容已发布配置：旧全局开关不再生效，也不再写入新配置。
  const config = { ...raw };
  delete config.globalEnabled;
  return { ok: true, config };
}

/**
 * 解析 JSON 文本并校验（为导入功能与调试保留；配置页已改为可视化编辑）。
 */
function parseConfigText(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['配置内容为空'] };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSON 语法错误：${(err && err.message) || err}`] };
  }
  if (options.rulesOnly && isPlainObject(raw)) {
    // 追加导入完全忽略文件中的全局设置，包括其中的非法取值。
    return validateConfig({ schemaVersion: raw.schemaVersion, rules: raw.rules }, { allowDuplicateNames: true });
  }
  return validateConfig(raw);
}

/**
 * 读取配置。未存过或校验失败（例如开发期旧格式）时回退到默认配置，
 * 并通过 source / errors 说明原因。
 *
 * @returns {Promise<{config: object, source: 'storage'|'default', errors?: string[]}>}
 */
async function loadConfig() {
  const data = await browser.storage.local.get(CONFIG_KEY);
  const stored = data[CONFIG_KEY];

  if (!stored) {
    return { config: clone(DEFAULT_CONFIG), source: 'default' };
  }

  // 读取时放宽重名校验：历史配置可能已经存在同名分组，
  // 直接判失败会整份回退默认值，反而让用户以为配置丢了。
  const result = validateConfig(stored, { allowDuplicateNames: true });
  if (!result.ok) {
    return { config: clone(DEFAULT_CONFIG), source: 'default', errors: result.errors };
  }
  return { config: result.config, source: 'storage' };
}

/** 保存配置；非法配置不会被写入。 */
async function saveConfig(config) {
  const result = validateConfig(config);
  if (!result.ok) return result;
  await browser.storage.local.set({ [CONFIG_KEY]: result.config });
  return { ok: true, config: result.config };
}

/** 清除用户配置，回到内置默认值（“恢复默认”）。 */
async function resetConfig() {
  await browser.storage.local.remove(CONFIG_KEY);
  return clone(DEFAULT_CONFIG);
}

/** 读取点击行为配置，未知值回退到「仅同步」。 */
function normalizeClickAction(value) {
  return CLICK_ACTIONS.includes(value) ? value : DEFAULT_CLICK_ACTION;
}

/** 读取语言配置，未知值回退到跟随浏览器。 */
function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * 由「点击行为 + 语言 + 规则数组」组装出可保存的配置。
 * 放在存储层是为了让字段映射有单测兜底——之前配置页自己组对象，
 * 漏掉过 highlight 字段，导致页面内标识保存后丢失。
 */
function buildConfigFromRules(rules, clickAction, language, groupsFirst = false, preferences = {}) {
  const list = Array.isArray(rules) ? rules : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    clickAction: normalizeClickAction(clickAction),
    language: normalizeLanguage(language),
    groupsFirst: groupsFirst === true,
    autoUpdateGroupRules: preferences.autoUpdateGroupRules !== false,
    showActionResult: preferences.showActionResult !== false,
    ...(preferences.globalTitleRule === undefined ? {} : { globalTitleRule: preferences.globalTitleRule }),
    rules: list.map((rule) => {
      const normalized = {
        id: String(rule && rule.id != null ? rule.id : ''),
        enabled: !rule || rule.enabled !== false,
        name: String(rule && rule.name != null ? rule.name : '').trim(),
        color: rule && GROUP_COLORS.includes(rule.color) ? rule.color : DEFAULT_COLOR,
        tabGroup: normalizeTabGroup(rule),
        note: String(rule && rule.note != null ? rule.note : '').trim(),
        patterns: (Array.isArray(rule && rule.patterns) ? rule.patterns : [])
          .map((pattern) => String(pattern).trim())
          .filter((pattern) => pattern !== '')
      };
      if (isPlainObject(rule && rule.highlight)) {
        normalized.highlight = rule.highlight;
      }
      if (isPlainObject(rule && rule.titleRule)) {
        normalized.titleRule = rule.titleRule;
      }
      return normalized;
    })
  };
}

/** 按序号循环取分组颜色，新建分组时用，保证相邻分组颜色不同。 */
function colorForIndex(index) {
  const number = Number(index);
  if (!Number.isFinite(number)) return GROUP_COLORS[0];
  return GROUP_COLORS[Math.abs(Math.floor(number)) % GROUP_COLORS.length];
}

/** 规则实际使用的分组颜色。 */
function colorOf(rule) {
  return rule && GROUP_COLORS.includes(rule.color) ? rule.color : DEFAULT_COLOR;
}

/** 分组颜色对应的色值，未知颜色回退到 grey。 */
function colorHexOf(rule) {
  return GROUP_COLOR_HEX[colorOf(rule)] || GROUP_COLOR_HEX.grey;
}

export {
  CONFIG_KEY,
  SCHEMA_VERSION,
  GROUP_COLORS,
  GROUP_COLOR_HEX,
  CLICK_ACTIONS,
  DEFAULT_CLICK_ACTION,
  LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_COLOR,
  DEFAULT_MIN_TABS,
  DEFAULT_CONFIG,
  clone,
  validateConfig,
  normalizeClickAction,
  normalizeLanguage,
  buildConfigFromRules,
  parseConfigText,
  loadConfig,
  saveConfig,
  resetConfig,
  colorForIndex,
  colorOf,
  colorHexOf
};
