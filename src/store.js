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
        patterns: ['*://localhost:*/*']
      }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
   * 把 schemaVersion 1 的旧配置迁移到当前结构：
   * - 单条 urlPattern → patterns 数组
   * - actions[0] 的 name / color / collapsed → 规则自身的分组属性
   * - 旧 priority 降序 → 数组顺序（顺序即优先级）
   */
  function migrate(config) {
    if (!isPlainObject(config) || config.schemaVersion !== 1) return config;

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

  /** 规则实际使用的分组颜色。 */
  function colorOf(rule) {
    return rule && GROUP_COLORS.includes(rule.color) ? rule.color : DEFAULT_COLOR;
  }

  const api = {
    CONFIG_KEY,
    SCHEMA_VERSION,
    GROUP_COLORS,
    DEFAULT_COLOR,
    DEFAULT_MIN_TABS,
    DEFAULT_CONFIG,
    clone,
    validateConfig,
    migrate,
    parseConfigText,
    loadConfig,
    saveConfig,
    resetConfig,
    colorOf
  };

  global.TabPilotStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
