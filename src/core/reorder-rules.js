/** 将规则移动到目标规则前/后，只改变数组顺序。无效或无变化时返回原数组。 */
export function reorderRules(rules, sourceId, targetId, after = false) {
  const source = rules.findIndex(rule => rule.id === sourceId);
  const target = rules.findIndex(rule => rule.id === targetId);
  if (source < 0 || target < 0 || source === target) return rules;
  const next = rules.slice();
  const [rule] = next.splice(source, 1);
  const destination = next.findIndex(item => item.id === targetId) + (after ? 1 : 0);
  next.splice(destination, 0, rule);
  return next.every((item, index) => item === rules[index]) ? rules : next;
}
