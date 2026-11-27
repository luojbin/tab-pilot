/** 支持的原生群组颜色；外部数据和 API 调用共用同一兜底。 */
export const GROUP_COLORS = Object.freeze([
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
]);
export const DEFAULT_COLOR = 'grey';

export function colorOf(rule) {
  return rule && GROUP_COLORS.includes(rule.color) ? rule.color : DEFAULT_COLOR;
}
