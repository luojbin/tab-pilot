/** 页内标识色板。原生色采样及增强对比定稿见 docs/colors；不控制原生群组色。 */
export const COLOR_THEMES = Object.freeze({
  'firefox-light': Object.freeze({ label: 'Firefox · 浅色', colors: Object.freeze({
    purple: '#9540c8', pink: '#b32e9f', red: '#c52d4f', green: '#008865', cyan: '#0a809f', yellow: '#b26100', orange: '#cd4208', grey: '#515054', blue: '#455fe7'
  }) }),
  'firefox-dark': Object.freeze({ label: 'Firefox · 深色', colors: Object.freeze({
    purple: '#d490ff', pink: '#f585d3', red: '#ff8998', green: '#4acca6', cyan: '#4cc4e1', yellow: '#f3a81e', orange: '#ff9565', grey: '#949297', blue: '#7bb2ff'
  }) }),
  'chrome-light': Object.freeze({ label: 'Chrome · 浅色', colors: Object.freeze({
    purple: '#9d39f3', pink: '#c809a8', red: '#db1b2b', green: '#188129', cyan: '#007b83', yellow: '#ffd036', orange: '#ff9436', grey: '#5f6369', blue: '#436bd7'
  }) }),
  'chrome-dark': Object.freeze({ label: 'Chrome · 深色', colors: Object.freeze({
    purple: '#cb93ff', pink: '#ff96de', red: '#ff928b', green: '#87eb84', cyan: '#88e3eb', yellow: '#ffdd7a', orange: '#ffb379', grey: '#dfe2e9', blue: '#a8bcff'
  }) }),
  'edge-light': Object.freeze({ label: 'Edge · 浅色', colors: Object.freeze({
    purple: '#8230ff', pink: '#e3008c', red: '#c239b3', green: '#004e8c', cyan: '#038387', yellow: '#986f0b', orange: '#ca5010', grey: '#706d6b', blue: '#296eeb'
  }) }),
  'edge-dark': Object.freeze({ label: 'Edge · 深色', colors: Object.freeze({
    purple: '#b696ff', pink: '#ee5fb7', red: '#cf87da', green: '#4a89ba', cyan: '#4cb4b7', yellow: '#c1a256', orange: '#df8e64', grey: '#84817e', blue: '#69a1fa'
  }) }),
  'vivid-light': Object.freeze({ label: 'Edge 增强对比 · 浅色', colors: Object.freeze({
    purple: '#8b21fb', pink: '#e3004e', red: '#e15cc5', green: '#2c5998', cyan: '#00a08d', yellow: '#b08500', orange: '#e66415', grey: '#656260', blue: '#588ff5'
  }) }),
  'vivid-dark': Object.freeze({ label: 'Edge 增强对比 · 深色', colors: Object.freeze({
    purple: '#8776d2', pink: '#ff7b85', red: '#edadfa', green: '#3691b1', cyan: '#45c8b5', yellow: '#f3c663', orange: '#fc863d', grey: '#898683', blue: '#a8c6ff'
  }) }),
  'classic': Object.freeze({ label: '经典', colors: Object.freeze({
    purple: '#9334e6', pink: '#d01884', red: '#d93025', green: '#1e8e3e', cyan: '#007b83', yellow: '#f9ab00', orange: '#e8710a', grey: '#9aa0a6', blue: '#1a73e8'
  }) }),
});

export const COLOR_THEME_IDS = Object.freeze(Object.keys(COLOR_THEMES));
export const CLASSIC_COLORS = COLOR_THEMES.classic.colors;

/** 显示名称按浏览器构建选择，与页内色彩主题独立。 */
export const COLOR_LABEL_SETS = Object.freeze({
  standard: Object.freeze({ grey: '灰色', blue: '蓝色', red: '红色', yellow: '黄色', green: '绿色', pink: '粉色', purple: '紫色', cyan: '青色', orange: '橙色' }),
  edge: Object.freeze({ grey: '灰色', blue: '蓝色', red: '紫罗兰色', yellow: '黄色', green: '亮蓝色', pink: '粉红', purple: '紫色', cyan: '青色', orange: '橙色' })
});

export function customTheme(value, themes = []) {
  return Array.isArray(themes) ? themes.find(theme => theme?.id === value) : undefined;
}

export function normalizeColorTheme(value, fallback = 'classic', themes = []) {
  return typeof value === 'string' && (Object.hasOwn(COLOR_THEMES, value) || customTheme(value, themes)) ? value : fallback;
}

export function themeColor(color, theme, themes = []) {
  const palette = ((Object.hasOwn(COLOR_THEMES, theme) ? COLOR_THEMES[theme] : customTheme(theme, themes)) || COLOR_THEMES.classic).colors;
  return Object.hasOwn(palette, color) ? palette[color] : palette.grey;
}
