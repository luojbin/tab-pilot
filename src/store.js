/**
 * TabPilot 存储层
 *
 * 唯一负责读写 browser.storage.local 的地方；所有配置读取都从这里走，
 * 以后换 IndexedDB / 同步存储只改本文件。
 */
(function (global) {
  'use strict';

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

  /**
   * 内置默认配置，相当于 v0.1.0 的“硬编码规则”，
   * 但走的是与用户配置完全相同的读取路径，v0.2.0 不需要重构。
   */
  const DEFAULT_CONFIG = {
    schemaVersion: SCHEMA_VERSION,
    globalEnabled: true,
    rules: [
      {
        id: 'dev-localhost',
        enabled: true,
        priority: 100,
        note: '本地开发环境',
        match: { urlPattern: '*://localhost:*/*', minTabs: 1 },
        actions: [{ type: 'group', name: '开发', color: 'green', collapsed: false }]
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
   * 错误信息带字段路径，便于导入时的提示（F4）。
   */
  function validateConfig(raw) {
    const errors = [];

    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['配置必须是一个 JSON 对象'] };
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

      if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
        errors.push(`${where}.enabled 必须是布尔值`);
      }
      if (
        rule.priority !== undefined &&
        (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority))
      ) {
        errors.push(`${where}.priority 必须是数字`);
      }

      if (
        !isPlainObject(rule.match) ||
        typeof rule.match.urlPattern !== 'string' ||
        rule.match.urlPattern.trim() === ''
      ) {
        errors.push(`${where}.match.urlPattern 必须是非空字符串`);
      } else if (rule.match.minTabs !== undefined) {
        const minTabs = rule.match.minTabs;
        if (
          typeof minTabs !== 'number' ||
          !Number.isFinite(minTabs) ||
          minTabs < 1 ||
          Math.floor(minTabs) !== minTabs
        ) {
          errors.push(`${where}.match.minTabs 必须是 >= 1 的整数`);
        }
      }

      if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
        errors.push(`${where}.actions 必须是非空数组`);
        return;
      }
      rule.actions.forEach((action, actionIndex) => {
        const at = `${where}.actions[${actionIndex}]`;
        if (!isPlainObject(action)) {
          errors.push(`${at} 必须是对象`);
          return;
        }
        if (action.type !== 'group') {
          errors.push(`${at}.type 目前只支持 "group"`);
          return;
        }
        if (typeof action.name !== 'string' || action.name.trim() === '') {
          errors.push(`${at}.name 必须是非空字符串`);
        }
        if (action.color !== undefined && !GROUP_COLORS.includes(action.color)) {
          errors.push(`${at}.color 必须是 ${GROUP_COLORS.join('/')} 之一`);
        }
        if (action.collapsed !== undefined && typeof action.collapsed !== 'boolean') {
          errors.push(`${at}.collapsed 必须是布尔值`);
        }
      });
    });

    return errors.length > 0 ? { ok: false, errors } : { ok: true, config: raw };
  }

  /**
   * 读取配置。未存过或校验失败时回退到默认配置，并通过 source / errors 说明原因。
   * @returns {Promise<{config: object, source: 'storage'|'default', errors?: string[]}>}
   */
  async function loadConfig() {
    const data = await browser.storage.local.get(CONFIG_KEY);
    const stored = data[CONFIG_KEY];

    if (!stored) {
      return { config: clone(DEFAULT_CONFIG), source: 'default' };
    }

    const result = validateConfig(stored);
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
    return { ok: true };
  }

  /** 清除用户配置，回到内置默认值（F4 的“恢复默认”）。 */
  async function resetConfig() {
    await browser.storage.local.remove(CONFIG_KEY);
    return clone(DEFAULT_CONFIG);
  }

  const api = {
    CONFIG_KEY,
    SCHEMA_VERSION,
    GROUP_COLORS,
    DEFAULT_CONFIG,
    clone,
    validateConfig,
    loadConfig,
    saveConfig,
    resetConfig
  };

  global.TabPilotStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
