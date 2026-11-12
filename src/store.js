/**
 * TabPilot 存储层
 *
 * 唯一负责读写 browser.storage.local 的地方；所有配置读取都从这里走，
 * 以后换 IndexedDB / 同步存储只改本文件。
 *
 * 配置结构（schemaVersion 2）：
 *   { schemaVersion, globalEnabled, rules: [rule] }
 *   rule = { id, enabled, name, color, collapsed, minTabs, note, patterns[] }
 * 一条规则对应一个标签页分组，`patterns` 里可以有多个匹配路径，
 * 规则在数组中的顺序就是优先级（越靠前越高）。
 */
(function (global) {
  'use strict';

  const CONFIG_KEY = 'tabpilot:config';
  const SCHEMA_VERSION = 3;

  /** 页面内标识的默认值（与 src/highlight.js 的 DEFAULT_HIGHLIGHT 保持一致）。 */
  const DEFAULT_HIGHLIGHT_CONFIG = {
    enabled: false,
    border: { sides: ['top', 'right', 'bottom', 'left'], width: 4, opacity: 100 },
    banner: { positions: ['topLeft'], size: 28, fontSize: 14, opacity: 60 }
  };

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
   */
  function validateConfig(raw) {
    const errors = [];

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
    if (!Array.isArray(raw.rules)) {
      errors.push('rules 必须是数组');
      return { ok: false, errors };
    }

    const seenIds = new Set();
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

      if (rule.highlight !== undefined) {
        const at = `${where}.highlight`;
        if (!isPlainObject(rule.highlight)) {
          errors.push(`${at} 必须是对象`);
        } else {
          const highlight = rule.highlight;

          if (highlight.enabled !== undefined && typeof highlight.enabled !== 'boolean') {
            errors.push(`${at}.enabled 必须是布尔值`);
          }

          // 早期统一的不透明度，兼容读取但不再写入
          checkInteger(highlight.opacity, 0, 100, `${at}.opacity`, errors);

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
   * 逐级迁移到当前 schemaVersion：
   * v1 → v2：单条 urlPattern → patterns；actions[0] → 规则属性；priority 降序 → 顺序
   * v2 → v3：为每条规则补上 highlight（页面内标识）默认值
   */
  function migrate(config) {
    let current = config;
    if (isPlainObject(current) && current.schemaVersion === 1) {
      current = migrateFromV1(current);
    }
    if (isPlainObject(current) && current.schemaVersion === 2) {
      current = migrateFromV2(current);
    }
    return current;
  }

  function migrateFromV1(config) {
    const oldRules = Array.isArray(config.rules) ? config.rules : [];
    const ordered = oldRules.slice().sort((a, b) => {
      const pa = Number(a && a.priority);
      const pb = Number(b && b.priority);
      return (Number.isFinite(pb) ? pb : 0) - (Number.isFinite(pa) ? pa : 0);
    });

    const rules = ordered
      .map((rule, index) => {
        const action = Array.isArray(rule.actions)
          ? rule.actions.find((item) => item && item.type === 'group')
          : null;
        const pattern = rule.match && rule.match.urlPattern;
        const minTabs = Number(rule.match && rule.match.minTabs);
        return {
          id: typeof rule.id === 'string' && rule.id ? rule.id : `rule-${index + 1}`,
          enabled: rule.enabled !== false,
          name: (action && action.name) || '未命名分组',
          color: (action && action.color) || DEFAULT_COLOR,
          collapsed: Boolean(action && action.collapsed),
          minTabs: Number.isFinite(minTabs) && minTabs >= 1 ? Math.floor(minTabs) : DEFAULT_MIN_TABS,
          note: typeof rule.note === 'string' ? rule.note : '',
          patterns: typeof pattern === 'string' && pattern ? [pattern] : []
        };
      })
      .filter((rule) => rule.patterns.length > 0);

    return {
      schemaVersion: 2,
      globalEnabled: config.globalEnabled !== false,
      rules
    };
  }

  function migrateFromV2(config) {
    const rules = (Array.isArray(config.rules) ? config.rules : []).map((rule) => {
      if (!isPlainObject(rule) || isPlainObject(rule.highlight)) return rule;
      return { ...rule, highlight: clone(DEFAULT_HIGHLIGHT_CONFIG) };
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      globalEnabled: config.globalEnabled !== false,
      rules
    };
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
    return validateConfig(migrate(raw));
  }

  /**
   * 读取配置。未存过或校验失败时回退到默认配置，并通过 source / errors 说明原因。
   * 旧格式会被就地迁移并写回，避免每次读取都重复迁移。
   *
   * @returns {Promise<{config: object, source: 'storage'|'default', errors?: string[], migrated?: boolean}>}
   */
  async function loadConfig() {
    const data = await browser.storage.local.get(CONFIG_KEY);
    const stored = data[CONFIG_KEY];

    if (!stored) {
      return { config: clone(DEFAULT_CONFIG), source: 'default' };
    }

    const migrated = migrate(stored);
    const result = validateConfig(migrated);
    if (!result.ok) {
      return { config: clone(DEFAULT_CONFIG), source: 'default', errors: result.errors };
    }

    const wasMigrated = migrated !== stored;
    if (wasMigrated) {
      try {
        await browser.storage.local.set({ [CONFIG_KEY]: migrated });
      } catch (err) {
        // 写回失败不影响本次读取
      }
    }
    return { config: result.config, source: 'storage', migrated: wasMigrated };
  }

  /** 保存配置；非法配置不会被写入。 */
  async function saveConfig(config) {
    const normalized = migrate(config);
    const result = validateConfig(normalized);
    if (!result.ok) return result;
    await browser.storage.local.set({ [CONFIG_KEY]: normalized });
    return { ok: true, config: normalized };
  }

  /** 清除用户配置，回到内置默认值（“恢复默认”）。 */
  async function resetConfig() {
    await browser.storage.local.remove(CONFIG_KEY);
    return clone(DEFAULT_CONFIG);
  }

  /**
   * 由「全局开关 + 规则数组」组装出可保存的配置。
   * 放在存储层是为了让字段映射有单测兜底——之前配置页自己组对象，
   * 漏掉过 highlight 字段，导致页面内标识保存后丢失。
   */
  function buildConfigFromRules(globalEnabled, rules) {
    const list = Array.isArray(rules) ? rules : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      globalEnabled: globalEnabled !== false,
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

  const api = {
    CONFIG_KEY,
    SCHEMA_VERSION,
    GROUP_COLORS,
    GROUP_COLOR_HEX,
    DEFAULT_COLOR,
    DEFAULT_MIN_TABS,
    DEFAULT_CONFIG,
    clone,
    validateConfig,
    migrate,
    buildConfigFromRules,
    parseConfigText,
    loadConfig,
    saveConfig,
    resetConfig,
    colorForIndex,
    colorOf,
    colorHexOf
  };

  global.TabPilotStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
