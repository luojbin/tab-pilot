/** 仅支持正式基线 schema 1 -> 2；开发期其他过渡格式不迁移。 */
export function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== 1) return raw;
  const config = JSON.parse(JSON.stringify(raw));
  config.schemaVersion = 2;
  if (!Array.isArray(config.rules)) return config;
  for (const rule of config.rules) {
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
  return config;
}
