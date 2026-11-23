/** 标题和 URL 双来源规则：非空条件同时匹配，首条命中停止。 */
const DEFAULT_TITLE_RULE = { enabled: false, rules: [], testCases: [] };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function normalizeEntry(raw) {
  const source = isObject(raw) ? raw : {};
  return {
    titlePattern: typeof source.titlePattern === 'string' ? source.titlePattern : '',
    urlPattern: typeof source.urlPattern === 'string' ? source.urlPattern : '',
    replacement: typeof source.replacement === 'string' ? source.replacement : '',
    description: typeof source.description === 'string' ? source.description : ''
  };
}
function normalizeTitleRule(rule) {
  const raw = isObject(rule?.titleRule) ? rule.titleRule : {};
  return { enabled: raw.enabled === true,
    rules: Array.isArray(raw.rules) ? raw.rules.map(normalizeEntry) : [],
    testCases: Array.isArray(raw.testCases) ? raw.testCases.map(row => ({
      title: typeof row?.title === 'string' ? row.title : '',
      url: typeof row?.url === 'string' ? row.url : ''
    })) : [] };
}
/** 去除可由界面固定符号表示的外层边界，保留转义美元符号。 */
function stripPatternAnchors(pattern) {
  let body = pattern.startsWith('^') ? pattern.slice(1) : pattern;
  if (body.endsWith('$')) {
    const escapes = body.slice(0, -1).match(/\\*$/)[0].length;
    if (escapes % 2 === 0) body = body.slice(0, -1);
  }
  return body;
}
const regexCache = new Map();
/** 显式边界与默认边界等价；转义的 \$ 仍是字面量。 */
function compilePattern(pattern) {
  if (!pattern.trim()) return null;
  const key = pattern;
  if (regexCache.has(key)) return regexCache.get(key);
  // 先校验原表达式，不能让补上的括号 意外修复非法输入。
  new RegExp(pattern);
  const body = stripPatternAnchors(pattern);
  // 非捕获包装保留编号；末尾的断言也排除 $ 对末尾换行的特殊容许。
  const compiled = new RegExp(`^(?:${body})$(?![\\s\\S])`);
  if (regexCache.size >= 200) regexCache.clear();
  regexCache.set(key, compiled);
  return compiled;
}
function compileEntry(entry) {
  const spec = normalizeEntry(entry);
  if (!spec.titlePattern.trim() && !spec.urlPattern.trim()) return { ok: false, reason: 'empty-pattern' };
  try {
    return { ok: true, titleRegex: compilePattern(spec.titlePattern), urlRegex: compilePattern(spec.urlPattern), replacement: spec.replacement };
  } catch (err) {
    return { ok: false, reason: 'invalid-regex', error: String(err.message || err) };
  }
}

/** 单次展开，捕获结果中的 $ 不会再次被解释；旧 $1/$<name> 等仍取标题。 */
function renderReplacement(template, titleMatch, urlMatch, source) {
  return template.replace(/\$\$|\$\{(title|url)\.([^}]+)\}|\$<([^>]+)>|\$(\d{1,2}|&|`|')/g,
    (token, scope, key, name, legacy) => {
      if (token === '$$') return '$';
      if (scope) {
        const match = scope === 'title' ? titleMatch : urlMatch;
        return /^\d+$/.test(key) ? match[Number(key)] ?? '' : match.groups?.[key] ?? '';
      }
      if (name !== undefined) return titleMatch.groups ? titleMatch.groups[name] ?? '' : token;
      if (legacy === '&') return titleMatch[0];
      if (legacy === '`') return source.slice(0, titleMatch.index);
      if (legacy === "'") return source.slice(titleMatch.index + titleMatch[0].length);
      const index = Number(legacy);
      if (index > 0 && index < titleMatch.length) return titleMatch[index] ?? '';
      if (legacy.length === 2 && Number(legacy[0]) > 0 && Number(legacy[0]) < titleMatch.length) return (titleMatch[Number(legacy[0])] ?? '') + legacy[1];
      return token;
    });
}
const wholeMatch = text => Object.assign([text], { index: 0, input: text });
function applyTitleRules(rule, text, url = '') {
  const source = typeof text === 'string' ? text : '';
  const address = typeof url === 'string' ? url : '';
  const spec = normalizeTitleRule(rule);
  const outcome = (ok, reason, error = null) => ({ ok, matched: false, result: source, ruleIndex: null, reason, error });
  if (!spec.enabled) return outcome(false, 'disabled');
  if (!spec.rules.length) return outcome(true, 'no-rules');
  let firstError = null;
  for (const [index, entry] of spec.rules.entries()) {
    const compiled = compileEntry(entry);
    if (!compiled.ok) { if (compiled.error && !firstError) firstError = compiled.error; continue; }
    const titleMatch = compiled.titleRegex ? compiled.titleRegex.exec(source) : wholeMatch(source);
    const urlMatch = compiled.urlRegex ? compiled.urlRegex.exec(address) : wholeMatch(address);
    if (!titleMatch || !urlMatch) continue;
    const result = renderReplacement(compiled.replacement, titleMatch, urlMatch, source);
    return { ok: true, matched: true, result, ruleIndex: index, reason: null, error: null };
  }
  return outcome(true, firstError ? 'invalid-regex' : 'no-match', firstError);
}
function applyTitleBatch(rule, rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const title = typeof row?.title === 'string' ? row.title : '';
    const url = typeof row?.url === 'string' ? row.url : '';
    return { source: title, title, url, ...applyTitleRules(rule, title, url) };
  });
}
export { DEFAULT_TITLE_RULE, normalizeTitleRule, stripPatternAnchors, compilePattern, compileEntry, applyTitleRules, applyTitleBatch };
