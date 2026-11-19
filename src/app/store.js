import browser from '../platform/browser.js';

/**
 * TabPilot 存储层
 *
 * 唯一负责读写 browser.storage.local 的地方；所有配置读取都从这里走，
 * 以后换 IndexedDB / 同步存储只改本文件。
 *
 * 配置结构（schemaVersion 1，1.0 之后的基线）：
 *   { schemaVersion, globalEnabled, rules: [rule] }
 *   rule = { id, enabled, name, color, collapsed, minTabs, note, patterns[],
 *            highlight{...}, titleRule{...} }
 * 一条规则对应一个标签页分组，`patterns` 里可以有多个匹配路径，
 * 规则在数组中的顺序就是优先级（越靠前越高）。
 *
 * 说明：开发期的 schemaVersion 2–5 属于过渡格式，1.0 起作废，不再提供迁移；
 * 以后的结构变更都从这里的 1 重新递增，并在当次改动里补迁移。
 */
const CONFIG_KEY = 'tabpilot:config';
const SCHEMA_VERSION = 1;

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
 *   syncRuleCollapse      同步后按规则里的「命中后折叠」折叠分组
 *   syncCollapseInactive  同步后折叠不含活动标签的分组
 *   syncCollapseAll       同步后折叠所有分组
 * 折叠只影响点击时所在的窗口。
 */
const CLICK_ACTIONS = ['sync', 'syncRuleCollapse', 'syncCollapseInactive', 'syncCollapseAll'];
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
  globalEnabled: true,
  clickAction: DEFAULT_CLICK_ACTION,
  groupsFirst: false,
  language: DEFAULT_LANGUAGE,
  rules: [
    {
      id: 'dev-localhost',
      enabled: true,
      name: '开发',
      color: 'green',
      collapsed: false,
      minTabs: 1,
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
        testText: ''
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

function checkInteger(value, min, max, path, errors) {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.floor(value) !== value ||
    value < min ||
    value > max
  ) {
    errors.push(`${path} 必须是 ${min}~${max} 的整数`);
  }
}

/**
 * 校验配置对象。返回 { ok: true, config } 或 { ok: false, errors: string[] }。
 * 错误信息带字段路径，配置页直接展示。
 *
 * @param {object} raw 待校验配置
 * @param {{allowDuplicateNames?: boolean}} [options] 仅供 loadConfig 放宽重名校验：
 *   历史配置里可能已经存在同名分组，读取时放行以免整份配置回退默认值；
 *   保存与导入仍然严格拒绝。
 */
function validateConfig(raw, options) {
  const errors = [];
  const opts = options || {};

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['配置必须是一个对象'] };
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `schemaVersion 必须为 ${SCHEMA_VERSION}，收到 ${JSON.stringify(raw.schemaVersion)}`
    );
  }
  if (typeof raw.globalEnabled !== 'boolean') {
    errors.push('globalEnabled 必须是布尔值');
  }
  if (raw.groupsFirst !== undefined && typeof raw.groupsFirst !== 'boolean') {
    errors.push('groupsFirst 必须是布尔值');
  }
  if (raw.clickAction !== undefined && !CLICK_ACTIONS.includes(raw.clickAction)) {
    errors.push(`clickAction 必须是 ${CLICK_ACTIONS.join('/')} 之一`);
  }
  if (raw.language !== undefined && !LANGUAGES.includes(raw.language)) {
    errors.push(`language 必须是 ${LANGUAGES.join('/')} 之一`);
  }
  if (!Array.isArray(raw.rules)) {
    errors.push('rules 必须是数组');
    return { ok: false, errors };
  }

  const seenIds = new Set();
  // 同名分组会在浏览器里落到同一个原生分组（actions.js 按分组标题复用），
  // 颜色 / 折叠会互相覆盖，因此保存与导入时拒绝重名；比较用 trim 后的名字。
  const seenNames = new Map();
  raw.rules.forEach((rule, index) => {
    const where = `rules[${index}]`;
    if (!isPlainObject(rule)) {
      errors.push(`${where} 必须是对象`);
      return;
    }

    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      errors.push(`${where}.id 必须是非空字符串`);
    } else if (seenIds.has(rule.id)) {
      errors.push(`${where}.id 重复：${rule.id}`);
    } else {
      seenIds.add(rule.id);
    }

    if (typeof rule.name !== 'string' || rule.name.trim() === '') {
      errors.push(`${where}.name 必须是非空字符串`);
    }
    const trimmedName = typeof rule.name === 'string' ? rule.name.trim() : '';
    if (trimmedName !== '') {
      const firstIndex = seenNames.get(trimmedName);
      if (firstIndex === undefined) {
        seenNames.set(trimmedName, index);
      } else if (opts.allowDuplicateNames !== true) {
        // 只报后面那条：配置页据此高亮需要改名的分组
        errors.push(`${where}.name 重复：${trimmedName}（与 rules[${firstIndex}] 同名）`);
      }
    }
    if (rule.color !== undefined && !GROUP_COLORS.includes(rule.color)) {
      errors.push(`${where}.color 必须是 ${GROUP_COLORS.join('/')} 之一`);
    }
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      errors.push(`${where}.enabled 必须是布尔值`);
    }
    if (rule.collapsed !== undefined && typeof rule.collapsed !== 'boolean') {
      errors.push(`${where}.collapsed 必须是布尔值`);
    }
    if (rule.note !== undefined && typeof rule.note !== 'string') {
      errors.push(`${where}.note 必须是字符串`);
    }
    if (rule.minTabs !== undefined) {
      const minTabs = rule.minTabs;
      if (
        typeof minTabs !== 'number' ||
        !Number.isFinite(minTabs) ||
        minTabs < 1 ||
        Math.floor(minTabs) !== minTabs
      ) {
        errors.push(`${where}.minTabs 必须是 >= 1 的整数`);
      }
    }

    if (rule.titleRule !== undefined) {
      const at = `${where}.titleRule`;
      if (!isPlainObject(rule.titleRule)) {
        errors.push(`${at} 必须是对象`);
      } else {
        const titleRule = rule.titleRule;
        if (titleRule.enabled !== undefined && typeof titleRule.enabled !== 'boolean') {
          errors.push(`${at}.enabled 必须是布尔值`);
        }
        if (titleRule.testText !== undefined && typeof titleRule.testText !== 'string') {
          errors.push(`${at}.testText 必须是字符串`);
        }
        if (titleRule.rules !== undefined) {
          if (!Array.isArray(titleRule.rules)) {
            errors.push(`${at}.rules 必须是数组`);
          } else {
            titleRule.rules.forEach((entry, index) => {
              const entryAt = `${at}.rules[${index}]`;
              if (!isPlainObject(entry)) {
                errors.push(`${entryAt} 必须是对象`);
                return;
              }
              if (typeof entry.pattern !== 'string' || entry.pattern.trim() === '') {
                errors.push(`${entryAt}.pattern 必须是非空字符串`);
              } else {
                try {
                  new RegExp(entry.pattern);
                } catch (err) {
                  errors.push(`${entryAt}.pattern 不是合法的正则：${(err && err.message) || err}`);
                }
              }
              if (entry.replacement !== undefined && typeof entry.replacement !== 'string') {
                errors.push(`${entryAt}.replacement 必须是字符串`);
              }
              if (entry.description !== undefined && typeof entry.description !== 'string') {
                errors.push(`${entryAt}.description 必须是字符串`);
              }
            });
          }
        }
      }
    }

    if (rule.highlight !== undefined) {
      const at = `${where}.highlight`;
      if (!isPlainObject(rule.highlight)) {
        errors.push(`${at} 必须是对象`);
      } else {
        const highlight = rule.highlight;

        if (highlight.enabled !== undefined && typeof highlight.enabled !== 'boolean') {
          errors.push(`${at}.enabled 必须是布尔值`);
        }

        if (highlight.border !== undefined) {
          if (!isPlainObject(highlight.border)) {
            errors.push(`${at}.border 必须是对象`);
          } else {
            if (highlight.border.sides !== undefined) {
              if (!Array.isArray(highlight.border.sides)) {
                errors.push(`${at}.border.sides 必须是数组`);
              } else if (highlight.border.sides.some((side) => typeof side !== 'string')) {
                errors.push(`${at}.border.sides 只能包含字符串`);
              }
            }
            checkInteger(highlight.border.width, 1, 24, `${at}.border.width`, errors);
            checkInteger(highlight.border.opacity, 0, 100, `${at}.border.opacity`, errors);
          }
        }

        if (highlight.banner !== undefined) {
          if (!isPlainObject(highlight.banner)) {
            errors.push(`${at}.banner 必须是对象`);
          } else {
            if (highlight.banner.positions !== undefined) {
              if (!Array.isArray(highlight.banner.positions)) {
                errors.push(`${at}.banner.positions 必须是数组`);
              } else if (highlight.banner.positions.some((item) => typeof item !== 'string')) {
                errors.push(`${at}.banner.positions 只能包含字符串`);
              }
            }
            checkInteger(highlight.banner.size, 8, 160, `${at}.banner.size`, errors);
            checkInteger(highlight.banner.fontSize, 8, 32, `${at}.banner.fontSize`, errors);
            checkInteger(highlight.banner.opacity, 0, 100, `${at}.banner.opacity`, errors);
          }
        }
      }
    }

    if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
      errors.push(`${where}.patterns 必须是非空数组（至少一个匹配路径）`);
      return;
    }
    rule.patterns.forEach((pattern, patternIndex) => {
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        errors.push(`${where}.patterns[${patternIndex}] 必须是非空字符串`);
      }
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, config: raw };
}

/**
 * 解析 JSON 文本并校验（为导入功能与调试保留；配置页已改为可视化编辑）。
 */
function parseConfigText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['配置内容为空'] };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSON 语法错误：${(err && err.message) || err}`] };
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
  await browser.storage.local.set({ [CONFIG_KEY]: config });
  return { ok: true, config };
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
 * 由「全局开关 + 点击行为 + 语言 + 规则数组」组装出可保存的配置。
 * 放在存储层是为了让字段映射有单测兜底——之前配置页自己组对象，
 * 漏掉过 highlight 字段，导致页面内标识保存后丢失。
 */
function buildConfigFromRules(globalEnabled, rules, clickAction, language, groupsFirst = false) {
  const list = Array.isArray(rules) ? rules : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    globalEnabled: globalEnabled !== false,
    clickAction: normalizeClickAction(clickAction),
    language: normalizeLanguage(language),
    groupsFirst: groupsFirst === true,
    rules: list.map((rule) => {
      const normalized = {
        id: String(rule && rule.id != null ? rule.id : ''),
        enabled: !rule || rule.enabled !== false,
        name: String(rule && rule.name != null ? rule.name : '').trim(),
        color: rule && GROUP_COLORS.includes(rule.color) ? rule.color : DEFAULT_COLOR,
        collapsed: Boolean(rule && rule.collapsed === true),
        minTabs: rule && rule.minTabs != null ? rule.minTabs : DEFAULT_MIN_TABS,
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
