/** 只追加分组规则，保留本机所有全局字段，不修改任一输入对象。 */
export function appendRules(current, importedRules, createId) {
  const config = JSON.parse(JSON.stringify(current));
  const ids = new Set(config.rules.map(rule => rule.id));
  const names = new Set(config.rules.map(rule => rule.name.trim()));
  for (const source of importedRules) {
    const rule = JSON.parse(JSON.stringify(source));
    const originalName = rule.name.trim();
    rule.name = originalName;
    if (names.has(rule.name)) {
      rule.name = `${originalName}-导入`;
      for (let suffix = 2; names.has(rule.name); suffix += 1) {
        rule.name = `${originalName}-导入-${suffix}`;
      }
    }
    if (ids.has(rule.id)) {
      let attempts = 0;
      do {
        if (++attempts > 100) throw new Error('无法生成唯一的规则 id');
        rule.id = createId();
      } while (typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id));
    }
    ids.add(rule.id);
    names.add(rule.name);
    config.rules.push(rule);
  }
  return config;
}
