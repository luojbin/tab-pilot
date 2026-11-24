/** 本地线条图标：24 × 24 画布、2px 描边，通过 currentColor 跟随控件状态。 */
const paths = {
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 6 6 6-6 6'],
  'expand-all': ['m7 9 5-5 5 5', 'm7 15 5 5 5-5'],
  'collapse-all': ['m7 4 5 5 5-5', 'm7 20 5-5 5 5'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  'arrow-down': ['M12 5v14', 'm5 12 7 7 7-7'],
  plus: ['M12 5v14', 'M5 12h14'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['m6 6 12 12', 'M6 18 18 6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  more: [
    'M5 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0',
    'M13 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0',
    'M21 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0'
  ]
};

/** 图标仅作装饰，按钮的文字 / aria-label 承担可访问名称。 */
export function createIcon(name, className = '', doc = document) {
  if (!Object.hasOwn(paths, name)) throw new Error(`Unknown icon: ${name}`);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attributes = {
    class: `ui-icon${className ? ` ${className}` : ''}`,
    viewBox: '0 0 24 24', width: '18', height: '18',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false'
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const d of paths[name]) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
