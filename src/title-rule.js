/**
 * TabPilot 标签页名规则（纯函数）
 *
 * 一个分组可以配置一组**命名规则**（按顺序匹配，命中第一条即停止）：
 *   titleRule = {
 *     enabled: boolean,
 *     rules: [
 *       { pattern, replacement, description }
 *     ],
 *     testText: string        // 多行测试文本，每行一个源标题
 *   }
 *
 * 每条命名规则：
 *   - pattern      源文本（正则表达式，只替换第一个匹配）
 *   - replacement  目标文本，支持 $1/$2、$<name>、$&、$$；需要加前缀直接写在这里
 *   - description  说明文字，仅用于界面展示
 *
 * 匹配：按数组顺序逐条尝试，第一条 pattern 命中就应用它，后续规则不再匹配；
 * 全部没命中则标题保持不变。
 */
(function (global) {
  'use strict';

  const DEFAULT_TITLE_RULE = {
    enabled: false,
    rules: [],
    testText: ''
  };

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function normalizeEntry(raw) {
    const source = isObject(raw) ? raw : {};
    const replacement = typeof source.replacement === 'string' ? source.replacement : '';

    // 兼容早期带 prefix 字段的写法：等价于把前缀直接拼进目标文本
    const prefix = typeof source.prefix === 'string' ? source.prefix : '';
    const escapedPrefix = prefix.replace(/\$/g, '$$$$');

    return {
      pattern: typeof source.pattern === 'string' ? source.pattern : '',
      replacement: escapedPrefix + replacement,
      description: typeof source.description === 'string' ? source.description : ''
    };
  }

  function normalizeTitleRule(rule) {
    const raw = rule && isObject(rule.titleRule) ? rule.titleRule : {};

    // 兼容 v4 之前的单条写法：{ enabled, pattern, replacement }
    const legacy =
      !Array.isArray(raw.rules) && typeof raw.pattern === 'string' && raw.pattern.trim() !== ''
        ? [{ pattern: raw.pattern, replacement: raw.replacement, description: '' }]
        : null;

    const list = Array.isArray(raw.rules) ? raw.rules : legacy || [];

    return {
      enabled: raw.enabled === true,
      rules: list.map(normalizeEntry),
      testText: typeof raw.testText === 'string' ? raw.testText : ''
    };
  }

  /**
   * 编译单条命名规则。
   * @returns {{ok: boolean, regex?: RegExp, replacement?: string, reason?: string, error?: string}}
   */
  function compileEntry(entry) {
    const spec = normalizeEntry(entry);
    if (spec.pattern.trim() === '') {
      return { ok: false, reason: 'empty-pattern' };
    }
    try {
      // 固定不带 g 标志：只替换第一个匹配
      const regex = new RegExp(spec.pattern);
      return { ok: true, regex, replacement: spec.replacement };
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-regex',
        error: String((err && err.message) || err)
      };
    }
  }

  /**
   * 对一条标题应用整组命名规则（第一条命中的生效）。
   * @returns {{ok: boolean, matched: boolean, result: string, ruleIndex: number|null, reason: string|null, error: string|null}}
   */
  function applyTitleRules(rule, text) {
    const source = typeof text === 'string' ? text : '';
    const spec = normalizeTitleRule(rule);

    if (!spec.enabled) {
      return { ok: false, matched: false, result: source, ruleIndex: null, reason: 'disabled', error: null };
    }
    if (spec.rules.length === 0) {
      return { ok: true, matched: false, result: source, ruleIndex: null, reason: 'no-rules', error: null };
    }

    let firstError = null;

    for (let index = 0; index < spec.rules.length; index += 1) {
      const compiled = compileEntry(spec.rules[index]);
      if (!compiled.ok) {
        if (compiled.reason === 'invalid-regex' && !firstError) firstError = compiled.error;
        continue;
      }
      if (!compiled.regex.test(source)) continue;

      return {
        ok: true,
        matched: true,
        result: source.replace(compiled.regex, compiled.replacement),
        ruleIndex: index,
        reason: null,
        error: null
      };
    }

    return {
      ok: true,
      matched: false,
      result: source,
      ruleIndex: null,
      reason: firstError ? 'invalid-regex' : 'no-match',
      error: firstError
    };
  }

  /** 把多行测试文本按行套用规则，返回每行的结果。空行会被跳过。 */
  function applyTitleBatch(rule, text) {
    const lines = String(text == null ? '' : text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');

    return lines.map((line) => {
      const outcome = applyTitleRules(rule, line);
      return {
        source: line,
        ok: outcome.ok,
        matched: outcome.matched,
        result: outcome.result,
        ruleIndex: outcome.ruleIndex,
        reason: outcome.reason,
        error: outcome.error
      };
    });
  }

  const api = {
    DEFAULT_TITLE_RULE,
    normalizeTitleRule,
    compileEntry,
    applyTitleRules,
    applyTitleBatch
  };

  global.TabPilotTitleRule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
