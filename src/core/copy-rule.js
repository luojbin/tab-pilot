/** 创建独立的规则副本；保留匹配路径，颜色由新序号决定，默认停用。 */
export function copyRule(source, rules, id, copyLabel = '副本', color = 'grey') {
  if (!id || rules.some(rule => rule.id === id)) {
    throw new Error('副本需要唯一的规则 id');
  }
  const names = new Set(rules.map(rule => rule.name.trim()));
  const base = source.name.trim();
  let name = `${base}（${copyLabel}）`;
  for (let index = 2; names.has(name); index += 1) {
    name = `${base}（${copyLabel} ${index}）`;
  }
  return {
    ...JSON.parse(JSON.stringify(source)),
    id,
    name,
    enabled: false,
    color
  };
}
