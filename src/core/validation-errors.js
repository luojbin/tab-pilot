/** 从结构化校验位置取规则组索引；兼容旧字符串时只认根路径，不认 .rules[N]。 */
export function invalidRuleIndexes(errors) {
  const indexes = new Set();
  const add = index => { if (Number.isInteger(index) && index >= 0) indexes.add(index); };
  for (const error of Array.isArray(errors) ? errors : []) {
    if (error && typeof error === 'object') {
      add(error.ruleIndex);
      for (const index of Array.isArray(error.relatedRuleIndexes) ? error.relatedRuleIndexes : []) add(index);
    } else {
      for (const match of String(error).matchAll(/(?:^|[^\w.])rules\[(\d+)\]/g)) add(Number(match[1]));
    }
  }
  return [...indexes].sort((a, b) => a - b);
}
