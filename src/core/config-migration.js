/** 旧替换语法只在迁移时处理；捕获编号依据正则自身解析，不在运行时兼容。 */
function migrateReplacement(pattern, replacement) {
  if (typeof replacement !== 'string' || typeof pattern !== 'string' || !pattern.trim()) return replacement;
  let captures;
  try {
    new RegExp(pattern);
    // 空分支保证得到匹配数组，其长度和 groups 键可直接反映全部捕获组。
    captures = new RegExp(`(?:${pattern})|`).exec('');
  } catch {
    return replacement; // 非法旧条件留给配置校验报错。
  }
  const reference = key => '${title.' + key + '}';
  return replacement.replace(/\$\$|\$\{(?:title|url)\.[^}]+\}|\$<([^>]+)>|\$(\d{1,2}|&|`|')/g,
    (token, name, legacy) => {
      if (token === '$$') return token;
      if (token.startsWith('${')) return '$' + token; // 旧模板中的新版样式文本原本是字面量。
      if (name !== undefined) {
        if (!captures.groups) return token;
        return Object.hasOwn(captures.groups, name) ? reference(name) : '';
      }
      if (legacy === '&') return reference(0);
      if (legacy === '`' || legacy === "'") return ''; // 旧 pattern 统一按全标题匹配。
      const index = Number(legacy);
      if (index > 0 && index < captures.length) return reference(index);
      if (legacy.length === 2 && Number(legacy[0]) > 0 && Number(legacy[0]) < captures.length) return reference(Number(legacy[0])) + legacy[1];
      return token; // 无对应捕获组时原本就是字面量。
    });
}

/** 正式 schema 1 直接迁移至当前 schema 2；不支持未发布的中间格式。 */
export function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== 1) return raw;
  const config = JSON.parse(JSON.stringify(raw));
  config.schemaVersion = 2;
  if (!Array.isArray(config.rules)) return config;
  for (const rule of config.rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
    const fallback = {
      enabled: true,
      minTabs: rule.minTabs === undefined ? 1 : rule.minTabs,
      collapsed: rule.collapsed === undefined ? false : rule.collapsed,
      strictMode: rule.strictMode === undefined ? (config.strictMode === undefined ? false : config.strictMode) : rule.strictMode
    };
    if (rule.tabGroup === undefined) rule.tabGroup = fallback;
    else if (rule.tabGroup && typeof rule.tabGroup === 'object' && !Array.isArray(rule.tabGroup)) rule.tabGroup = { ...fallback, ...rule.tabGroup };
    delete rule.minTabs;
    delete rule.collapsed;
    delete rule.strictMode;
    const spec = rule?.titleRule;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    if (Array.isArray(spec.rules)) {
      spec.rules = spec.rules.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const { pattern, ...rest } = entry;
        return { ...rest, titlePattern: pattern, urlPattern: '',
          replacement: migrateReplacement(pattern, rest.replacement) };
      });
    }
    if (spec.testText !== undefined) {
      // 非字符串保留为非法值，交给校验拒绝，不能静默丢弃坏配置。
      spec.testCases = typeof spec.testText === 'string'
        ? spec.testText.split(/\r?\n/).map(title => title.trim()).filter(Boolean).map(title => ({ title, url: '' }))
        : spec.testText;
      delete spec.testText;
    }
  }
  if (typeof config.strictMode === 'boolean') delete config.strictMode;
  return config;
}
