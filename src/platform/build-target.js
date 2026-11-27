/** 构建时注入目标及默认主题；直接运行源码时使用 Firefox 默认值。 */
export const BUILD_TARGET = typeof __TABPILOT_TARGET__ === 'string' ? __TABPILOT_TARGET__ : 'firefox';
export const BUILD_DEFAULT_COLOR_THEME = typeof __TABPILOT_DEFAULT_THEME__ === 'string'
  ? __TABPILOT_DEFAULT_THEME__ : 'firefox-light';
export const BUILD_COLOR_LABEL_SET = typeof __TABPILOT_COLOR_LABEL_SET__ === 'string'
  ? __TABPILOT_COLOR_LABEL_SET__ : 'standard';
