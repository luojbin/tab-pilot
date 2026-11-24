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
        if (typeof rest.replacement === 'string') {
          rest.replacement = rest.replacement.replace(/\$\$|\$\{(?:title|url)\.[^}]+\}/g,
            token => token === '$$' ? token : '$' + token);
        }
        return { ...rest, titlePattern: pattern, urlPattern: '' };
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
