/**
 * TabPilot 页面内标识规格（纯函数）
 *
 * 一条规则可以附带一个 highlight 配置：
 *   enabled            是否在该分组的页面上显示标识
 *   border.sides       哪些边显示边框（top/right/bottom/left）
 *   border.width       边框宽度（px）
 *   border.opacity     边框不透明度（0–100，默认 100，即不透明）
 *   banner.positions   banner 位置：上下左右 + 四个角（角上为斜向 banner）
 *   banner.size        banner 厚度 / 长度基准（px）
 *   banner.fontSize    banner 文字大小（px）
 *   banner.opacity     banner 不透明度（0–100，默认 60）
 *
 * 兼容早期写法：若高层有 `highlight.opacity`，会作为两部分的兜底值。
 *
 * 本文件不依赖浏览器 API，background 与 content script 共用，
 * 配置页也用它把规则规范成可渲染的规格。
 */
(function (global) {
  'use strict';

  const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
  const BANNER_POSITIONS = [
    'top',
    'right',
    'bottom',
    'left',
    'topLeft',
    'topRight',
    'bottomRight',
    'bottomLeft'
  ];

  const LIMITS = {
    borderWidth: { min: 1, max: 24, fallback: 4 },
    borderOpacity: { min: 0, max: 100, fallback: 100 },
    bannerSize: { min: 8, max: 160, fallback: 28 },
    fontSize: { min: 8, max: 32, fallback: 14 },
    bannerOpacity: { min: 0, max: 100, fallback: 60 }
  };

  const DEFAULT_HIGHLIGHT = {
    enabled: false,
    border: { sides: ['top', 'right', 'bottom', 'left'], width: 4, opacity: 100 },
    banner: { positions: ['topLeft'], size: 28, fontSize: 14, opacity: 60 }
  };

  function clampInt(value, limits) {
    // null / undefined / 空串视为“没填”，用默认值而不是钳到最小值
    if (value === null || value === undefined || value === '') return limits.fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return limits.fallback;
    const rounded = Math.round(number);
    if (rounded < limits.min) return limits.min;
    if (rounded > limits.max) return limits.max;
    return rounded;
  }

  function uniqueKnown(values, allowed) {
    if (!Array.isArray(values)) return [];
    const out = [];
    for (const value of values) {
      if (allowed.includes(value) && !out.includes(value)) out.push(value);
    }
    return out;
  }

  /**
   * 把规则上的 highlight 规范成可直接渲染的规格。
   * 缺字段、越界数值、未知位置都在这里收敛，渲染层不再做判断。
   */
  function normalizeHighlight(rule) {
    // 完全没有配置时（新建分组）用默认规格：四边边框 + 左上角 banner
    if (!rule || rule.highlight === undefined || rule.highlight === null) {
      return JSON.parse(JSON.stringify(DEFAULT_HIGHLIGHT));
    }
    const raw = typeof rule.highlight === 'object' ? rule.highlight : {};
    const border = raw.border && typeof raw.border === 'object' ? raw.border : {};
    const banner = raw.banner && typeof raw.banner === 'object' ? raw.banner : {};

    return {
      enabled: raw.enabled === true,
      border: {
        sides: uniqueKnown(border.sides, BORDER_SIDES),
        width: clampInt(border.width, LIMITS.borderWidth),
        opacity: clampInt(border.opacity, LIMITS.borderOpacity)
      },
      banner: {
        positions: uniqueKnown(banner.positions, BANNER_POSITIONS),
        size: clampInt(banner.size, LIMITS.bannerSize),
        fontSize: clampInt(banner.fontSize, LIMITS.fontSize),
        opacity: clampInt(banner.opacity, LIMITS.bannerOpacity)
      }
    };
  }

  /** 是否真的需要往页面里塞东西。 */
  function hasVisibleHighlight(rule) {
    const spec = normalizeHighlight(rule);
    return spec.enabled && (spec.border.sides.length > 0 || spec.banner.positions.length > 0);
  }

  /** 相对亮度，用于决定 banner 文字用深色还是浅色。 */
  function luminance(hex) {
    const value = String(hex || '').replace('#', '');
    if (value.length !== 6) return 0;
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** 给定底色，返回可读的文字颜色。 */
  function textColorFor(hex) {
    return luminance(hex) > 0.55 ? '#101114' : '#ffffff';
  }

  /**
   * 边框的定位样式（不含 position 与颜色，由调用方补）。
   * 页面内用 fixed，配置页预览用 absolute，因此这里只给四边对齐方式。
   */
  function borderStyle(side, width) {
    if (side === 'top' || side === 'bottom') {
      return { left: '0', right: '0', height: `${width}px`, [side]: '0' };
    }
    return { top: '0', bottom: '0', width: `${width}px`, [side]: '0' };
  }

  /**
   * banner 长度：按尺寸与文字长度估算，四角会额外加长以便端头伸出边缘。
   * limits 用于调整下限/上限——配置页的小预览会传入更小的值，让斜带更贴近角部。
   */
  function bannerMetrics(text, size, fontSize, limits) {
    const label = typeof text === 'string' ? text : '';
    const minLength = limits && Number.isFinite(limits.minLength) ? limits.minLength : 120;
    const maxLength = limits && Number.isFinite(limits.maxLength) ? limits.maxLength : 420;
    const estimatedText = label.length * fontSize * 0.95 + 24;
    const baseLength = Math.min(Math.max(size * 4, estimatedText, minLength), maxLength);
    return { baseLength, length: Math.round(baseLength * 1.4) };
  }

  /**
   * banner 的定位样式（不含 position / 背景色 / 字体，由调用方补）。
   * 上下左右贴边并随文字收缩、内侧圆角；四角为 45° 斜带，两端越过边缘。
   */
  function bannerStyle(position, text, size, fontSize, limits) {
    const radius = Math.max(6, Math.round(size * 0.35));

    if (position === 'top' || position === 'bottom') {
      return {
        left: '50%',
        transform: 'translateX(-50%)',
        [position]: '0',
        height: `${size}px`,
        width: 'auto',
        padding: '0 12px',
        borderRadius: position === 'top' ? `0 0 ${radius}px ${radius}px` : `${radius}px ${radius}px 0 0`
      };
    }

    if (position === 'left' || position === 'right') {
      return {
        top: '50%',
        transform: 'translateY(-50%)',
        [position]: '0',
        width: `${size}px`,
        height: 'auto',
        padding: '12px 0',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        borderRadius: position === 'left' ? `0 ${radius}px ${radius}px 0` : `${radius}px 0 0 ${radius}px`
      };
    }

    const { baseLength, length } = bannerMetrics(text, size, fontSize, limits);
    // 斜带中心到两条边的距离按 baseLength 算，长度放大后端头会伸到边缘之外
    const centerInset = baseLength * 0.3536;
    const alongEdge = centerInset - length / 2;

    const corners = {
      topLeft: { vertical: 'top', horizontal: 'left', angle: -45 },
      topRight: { vertical: 'top', horizontal: 'right', angle: 45 },
      bottomLeft: { vertical: 'bottom', horizontal: 'left', angle: 45 },
      bottomRight: { vertical: 'bottom', horizontal: 'right', angle: -45 }
    };
    const corner = corners[position];
    if (!corner) return {};

    return {
      width: `${length}px`,
      height: `${size}px`,
      [corner.vertical]: `${centerInset - size / 2}px`,
      [corner.horizontal]: `${alongEdge}px`,
      transform: `rotate(${corner.angle}deg)`
    };
  }

  const api = {
    BORDER_SIDES,
    BANNER_POSITIONS,
    LIMITS,
    DEFAULT_HIGHLIGHT,
    normalizeHighlight,
    hasVisibleHighlight,
    borderStyle,
    bannerMetrics,
    bannerStyle,
    luminance,
    textColorFor
  };

  global.TabPilotHighlight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
