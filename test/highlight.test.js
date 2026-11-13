import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BORDER_SIDES,
  BANNER_POSITIONS,
  DEFAULT_HIGHLIGHT,
  normalizeHighlight,
  hasVisibleHighlight,
  borderStyle,
  bannerMetrics,
  bannerStyle
} from '../src/core/highlight.js';

test('normalizeHighlight：缺省时给出一份「关闭」规格', () => {
  assert.deepEqual(normalizeHighlight({}), DEFAULT_HIGHLIGHT);
  assert.deepEqual(normalizeHighlight(null), DEFAULT_HIGHLIGHT);
  assert.equal(normalizeHighlight({}).enabled, false);
});

test('normalizeHighlight：enabled 只认 true', () => {
  assert.equal(normalizeHighlight({ highlight: { enabled: true } }).enabled, true);
  assert.equal(normalizeHighlight({ highlight: { enabled: 'true' } }).enabled, false);
  assert.equal(normalizeHighlight({ highlight: { enabled: 1 } }).enabled, false);
});

test('normalizeHighlight：过滤未知位置并去重', () => {
  const spec = normalizeHighlight({
    highlight: {
      enabled: true,
      border: { sides: ['top', 'top', 'diagonal', 'left'], width: 6 },
      banner: { positions: ['topLeft', 'nope', 'topLeft', 'bottomRight'], size: 40, fontSize: 18 }
    }
  });

  assert.deepEqual(spec.border.sides, ['top', 'left']);
  assert.deepEqual(spec.banner.positions, ['topLeft', 'bottomRight']);
  assert.deepEqual(BORDER_SIDES, ['top', 'right', 'bottom', 'left']);
  assert.equal(BANNER_POSITIONS.length, 8);
});

test('normalizeHighlight：数值越界时收敛到范围内', () => {
  const low = normalizeHighlight({
    highlight: { border: { width: 0 }, banner: { size: 1, fontSize: 2 } }
  });
  assert.equal(low.border.width, 1);
  assert.equal(low.banner.size, 8);
  assert.equal(low.banner.fontSize, 8);

  const high = normalizeHighlight({
    highlight: { border: { width: 999 }, banner: { size: 999, fontSize: 999 } }
  });
  assert.equal(high.border.width, 24);
  assert.equal(high.banner.size, 160);
  assert.equal(high.banner.fontSize, 32);
});

test('normalizeHighlight：非数字回退到默认值', () => {
  const spec = normalizeHighlight({
    highlight: { border: { width: 'wide' }, banner: { size: null, fontSize: undefined } }
  });
  assert.equal(spec.border.width, 4);
  assert.equal(spec.banner.size, 28);
  assert.equal(spec.banner.fontSize, 14);
});

test('hasVisibleHighlight：需要开启且有边框或 banner', () => {
  assert.equal(hasVisibleHighlight({ highlight: { enabled: true } }), false);
  assert.equal(
    hasVisibleHighlight({ highlight: { enabled: true, border: { sides: ['top'] } } }),
    true
  );
  assert.equal(
    hasVisibleHighlight({ highlight: { enabled: true, banner: { positions: ['topLeft'] } } }),
    true
  );
  assert.equal(
    hasVisibleHighlight({ highlight: { enabled: false, border: { sides: ['top'] } } }),
    false
  );
});

test('normalizeHighlight：边框默认不透明，banner 默认 60', () => {
  const spec = normalizeHighlight({});
  assert.equal(spec.border.opacity, 100);
  assert.equal(spec.banner.opacity, 60);
});

test('normalizeHighlight：边框与 banner 的不透明度分别收敛到 0–100', () => {
  const high = normalizeHighlight({
    highlight: { border: { opacity: 150 }, banner: { opacity: 999 } }
  });
  assert.equal(high.border.opacity, 100);
  assert.equal(high.banner.opacity, 100);

  const low = normalizeHighlight({
    highlight: { border: { opacity: -10 }, banner: { opacity: -1 } }
  });
  assert.equal(low.border.opacity, 0);
  assert.equal(low.banner.opacity, 0);

  const strings = normalizeHighlight({
    highlight: { border: { opacity: '70' }, banner: { opacity: '30' } }
  });
  assert.equal(strings.border.opacity, 70);
  assert.equal(strings.banner.opacity, 30);

  const missing = normalizeHighlight({
    highlight: { border: { opacity: null }, banner: { opacity: null } }
  });
  assert.equal(missing.border.opacity, 100);
  assert.equal(missing.banner.opacity, 60);
});

test('normalizeHighlight：显式部分不透明度按各自的值收敛', () => {
  const spec = normalizeHighlight({ highlight: { border: { opacity: 90 } } });
  assert.equal(spec.border.opacity, 90);
  assert.equal(spec.banner.opacity, 60);
});

test('borderStyle：四条边各自贴边', () => {
  assert.deepEqual(borderStyle('top', 6), { left: '0', right: '0', height: '6px', top: '0' });
  assert.deepEqual(borderStyle('bottom', 6), { left: '0', right: '0', height: '6px', bottom: '0' });
  assert.deepEqual(borderStyle('left', 5), { top: '0', bottom: '0', width: '5px', left: '0' });
  assert.deepEqual(borderStyle('right', 5), { top: '0', bottom: '0', width: '5px', right: '0' });
});

test('bannerStyle：上下贴边、宽度随文字、内侧圆角', () => {
  const top = bannerStyle('top', '开发环境', 30, 14);
  assert.equal(top.width, 'auto');
  assert.equal(top.height, '30px');
  assert.equal(top.left, '50%');
  assert.equal(top.transform, 'translateX(-50%)');
  assert.equal(top.borderRadius, '0 0 11px 11px');

  const bottom = bannerStyle('bottom', '开发环境', 30, 14);
  assert.equal(bottom.borderRadius, '11px 11px 0 0');
});

test('bannerStyle：左右为竖排贴边标签，圆角在内侧', () => {
  const left = bannerStyle('left', '开发环境', 30, 14);
  assert.equal(left.width, '30px');
  assert.equal(left.writingMode, 'vertical-rl');
  assert.equal(left.borderRadius, '0 11px 11px 0');

  const right = bannerStyle('right', '开发环境', 30, 14);
  assert.equal(right.borderRadius, '11px 0 0 11px');
});

test('bannerStyle：四角为斜带，长度按文字放大且端头越过边缘', () => {
  const corner = bannerStyle('topRight', '开发环境', 30, 14);
  assert.equal(corner.width, '168px');
  assert.equal(corner.height, '30px');
  assert.equal(corner.transform, 'rotate(45deg)');
  assert.ok(parseFloat(corner.right) < 0, '横向偏移为负，端头才会伸到边缘外');
  assert.ok(parseFloat(corner.top) > 0);

  const expectedTop = 120 * 0.3536 - 15;
  assert.ok(Math.abs(parseFloat(corner.top) - expectedTop) < 0.01);
});

test('bannerMetrics：长文字放大长度，但有上限', () => {
  const short = bannerMetrics('开发', 30, 14);
  assert.equal(short.baseLength, 120);
  assert.equal(short.length, 168);

  const medium = bannerMetrics('一个特别长的分组名称', 30, 14);
  assert.ok(medium.baseLength > 120);
  assert.equal(medium.length, Math.round(medium.baseLength * 1.4));

  const veryLong = bannerMetrics('开发'.repeat(30), 30, 14);
  assert.equal(veryLong.baseLength, 420);
  assert.equal(veryLong.length, 588);
});

test('bannerStyle：可传更小的长度下限，让斜带贴近角部（预览用）', () => {
  const normal = bannerStyle('topLeft', 'XXX', 12, 5);
  const compact = bannerStyle('topLeft', 'XXX', 12, 5, { minLength: 60, maxLength: 120 });

  assert.ok(parseFloat(compact.width) < parseFloat(normal.width));
  assert.ok(parseFloat(compact.left) > parseFloat(normal.left), '负偏移更小，说明更靠近角部');
  assert.ok(Math.abs(parseFloat(compact.top) - (60 * 0.3536 - 6)) < 0.01);
});

test('normalizeHighlight：无配置时默认四边边框 + 左上角 banner', () => {
  const spec = normalizeHighlight({});
  assert.deepEqual(spec.border.sides, ['top', 'right', 'bottom', 'left']);
  assert.deepEqual(spec.banner.positions, ['topLeft']);
  assert.equal(spec.enabled, false);
});

test('normalizeHighlight：显式写了 highlight 就按内容来（不套默认边框）', () => {
  const spec = normalizeHighlight({ highlight: { enabled: true } });
  assert.deepEqual(spec.border.sides, []);
  assert.deepEqual(spec.banner.positions, []);
  assert.equal(spec.enabled, true);
});
