const test = require('node:test');
const assert = require('node:assert/strict');

const {
  match,
  explain,
  globToRegExp,
  minTabsOf,
  sortRules,
  DEFAULT_MIN_TABS
} = require('../src/rules.js');

function tab(id, url, windowId = 1) {
  return { id, url, windowId, groupId: -1 };
}

const devRule = {
  id: 'dev-localhost',
  enabled: true,
  priority: 100,
  match: { urlPattern: '*://localhost:*/*', minTabs: 1 },
  actions: [{ type: 'group', name: '开发', color: 'green', collapsed: false }]
};

const codeRule = {
  id: 'code-github',
  enabled: true,
  priority: 90,
  match: { urlPattern: '*://*.github.com/*', minTabs: 3 },
  actions: [{ type: 'group', name: '代码', color: 'blue', collapsed: false }]
};

const fallbackRule = {
  id: 'zz-fallback',
  enabled: true,
  priority: 10,
  match: { urlPattern: '*://*/*', minTabs: 1 },
  actions: [{ type: 'group', name: '其他', color: 'grey', collapsed: false }]
};

test('globToRegExp：* 通配且匹配任意端口', () => {
  const re = globToRegExp('*://localhost:*/*');
  assert.equal(re.test('http://localhost:3000/app'), true);
  assert.equal(re.test('https://localhost:8443/'), true);
  assert.equal(re.test('http://localhost.evil.com/'), false);
  assert.equal(re.test('https://example.com/'), false);
});

test('globToRegExp：正则元字符按字面量处理', () => {
  const re = globToRegExp('*://example.com/a?b=1');
  assert.equal(re.test('https://example.com/a?b=1'), true);
  // ? 不是量词，只精确匹配一个字面量 ?
  assert.equal(re.test('https://example.com/ab=1'), false);
});

test('globToRegExp：主机名 `*.` 前缀同时匹配裸域名与子域名', () => {
  // 与浏览器 match pattern 语义一致：*.mozilla.org 覆盖 mozilla.org 本身
  const re = globToRegExp('*://*.github.com/*');
  assert.equal(re.test('https://github.com/'), true);
  assert.equal(re.test('https://github.com/user/repo'), true);
  assert.equal(re.test('https://www.github.com/a'), true);
  assert.equal(re.test('https://a.b.github.com/a'), true);
  // 不能误伤相似域名
  assert.equal(re.test('https://notgithub.com/'), false);
  assert.equal(re.test('https://github.com.evil.com/'), false);
});

test('globToRegExp：不带 `*.` 的精确主机只匹配该主机', () => {
  const re = globToRegExp('*://github.com/*');
  assert.equal(re.test('https://github.com/'), true);
  assert.equal(re.test('https://www.github.com/'), false);
});

test('globToRegExp：空模式抛错', () => {
  assert.throws(() => globToRegExp(''), TypeError);
});

test('match：命中 urlPattern 后返回该规则的动作', () => {
  const result = match(tab(1, 'http://localhost:3000/'), [devRule], {});
  assert.equal(result.ruleId, 'dev-localhost');
  assert.deepEqual(result.actions, devRule.actions);
});

test('match：不匹配的 URL 返回 null', () => {
  assert.equal(match(tab(1, 'https://example.com/'), [devRule], {}), null);
});

test('match：高优先级优先', () => {
  const broad = {
    id: 'broad',
    enabled: true,
    priority: 1,
    match: { urlPattern: '*://localhost:*/*', minTabs: 1 },
    actions: [{ type: 'group', name: '宽泛', color: 'grey' }]
  };
  const result = match(tab(1, 'http://localhost:3000/'), [broad, devRule], {});
  assert.equal(result.ruleId, 'dev-localhost');
});

test('match：同优先级按 id 字典序，结果稳定', () => {
  const b = {
    id: 'b-rule',
    enabled: true,
    priority: 50,
    match: { urlPattern: '*://example.com/*', minTabs: 1 },
    actions: [{ type: 'group', name: 'B', color: 'red' }]
  };
  const a = {
    id: 'a-rule',
    enabled: true,
    priority: 50,
    match: { urlPattern: '*://example.com/*', minTabs: 1 },
    actions: [{ type: 'group', name: 'A', color: 'red' }]
  };
  assert.equal(match(tab(1, 'https://example.com/'), [b, a], {}).ruleId, 'a-rule');
  assert.equal(match(tab(1, 'https://example.com/'), [a, b], {}).ruleId, 'a-rule');
});

test('match：enabled=false 的规则被跳过', () => {
  const disabled = { ...devRule, enabled: false };
  assert.equal(match(tab(1, 'http://localhost:3000/'), [disabled], {}), null);
});

test('match：全局暂停时不命中任何规则', () => {
  const result = explain(tab(1, 'http://localhost:3000/'), [devRule], {
    globalEnabled: false
  });
  assert.equal(result.matched, null);
  assert.match(result.steps[0].note, /全局暂停/);
});

test('match：无 URL 的标签页不命中', () => {
  const result = explain({ id: 1, windowId: 1 }, [devRule], {});
  assert.equal(result.matched, null);
  assert.match(result.steps[0].note, /尚无 URL/);
});

test('阈值：同一规则标签数不足 minTabs 时不归组', () => {
  const first = tab(1, 'https://www.github.com/a');
  const target = tab(2, 'https://gist.github.com/b');
  const result = explain(target, [codeRule], { tabs: [first, target] });
  assert.equal(result.matched, null);
  assert.equal(result.steps[0].count, 2);
  assert.equal(result.steps[0].minTabs, 3);
  assert.equal(result.steps[0].thresholdMet, false);
});

test('阈值：达到 minTabs 时归组', () => {
  const tabs = [
    tab(1, 'https://www.github.com/a'),
    tab(2, 'https://gist.github.com/b'),
    tab(3, 'https://api.github.com/c')
  ];
  const result = match(tabs[2], [codeRule], { tabs });
  assert.equal(result.ruleId, 'code-github');
  assert.equal(result.actions[0].name, '代码');
});

test('阈值：数量不足时不命中（单标签场景）', () => {
  const target = tab(1, 'https://www.github.com/a');
  const result = explain(target, [codeRule], { tabs: [target] });
  assert.equal(result.matched, null);
  assert.equal(result.steps[0].thresholdMet, false);
  assert.equal(result.steps[0].count, 1);
});

test('阈值：未达成时继续尝试后续规则', () => {
  const target = tab(1, 'https://www.github.com/a');
  const result = match(target, [codeRule, fallbackRule], { tabs: [target] });
  assert.equal(result.ruleId, 'zz-fallback');
});

test('阈值：只统计同一窗口内的标签', () => {
  const otherWindow = tab(9, 'https://other.github.com/z', 2);
  const sameWindow = [
    tab(1, 'https://www.github.com/a', 1),
    tab(2, 'https://gist.github.com/b', 1)
  ];
  const target = tab(3, 'https://api.github.com/c', 1);
  // 窗口 2 的标签不应计入：本窗口 3 个（含自身）
  const result = explain(target, [codeRule], { tabs: [...sameWindow, target, otherWindow] });
  assert.equal(result.steps[0].count, 3);
});

test('explain：达成阈值时返回同窗口内命中的标签 id', () => {
  const tabs = [
    tab(1, 'https://www.github.com/a'),
    tab(2, 'https://gist.github.com/b'),
    tab(3, 'https://api.github.com/c'),
    tab(4, 'https://example.com/x'),
    tab(5, 'https://www.github.com/d', 2) // 其他窗口，不应计入
  ];
  const { matched } = explain(tabs[0], [codeRule], { tabs });
  assert.equal(matched.minTabs, 3);
  assert.deepEqual(matched.tabIds.slice().sort((a, b) => a - b), [1, 2, 3]);
});

test('explain：tabIds 是候选集合，是否一并归组由调用方决定', () => {
  const tabs = [tab(1, 'http://localhost:3000/'), tab(2, 'http://localhost:3001/')];
  const { matched } = explain(tabs[0], [devRule], { tabs });
  // 无阈值规则同样是完整候选；background 只在 minTabs > 1 时使用它们
  assert.deepEqual(matched.tabIds.slice().sort((a, b) => a - b), [1, 2]);
  assert.equal(matched.minTabs, 1);
});

test('minTabsOf：缺省与非法值回退到 1', () => {
  assert.equal(minTabsOf({ match: {} }), DEFAULT_MIN_TABS);
  assert.equal(minTabsOf({ match: { minTabs: 0 } }), 1);
  assert.equal(minTabsOf({ match: { minTabs: 2.5 } }), 2);
  assert.equal(minTabsOf({ match: { minTabs: '3' } }), 3);
  assert.equal(minTabsOf({ match: { minTabs: 4 } }), 4);
});

test('sortRules：过滤无效规则并保持优先级顺序', () => {
  const sorted = sortRules([
    { id: 'low', priority: 1, match: { urlPattern: '*://a/*' } },
    { id: 'high', priority: 99, match: { urlPattern: '*://b/*' } },
    { id: 'no-pattern', priority: 50, match: {} },
    { id: 'disabled', priority: 80, enabled: false, match: { urlPattern: '*://c/*' } }
  ]);
  assert.deepEqual(
    sorted.map((rule) => rule.id),
    ['high', 'low']
  );
});

test('explain：返回逐条规则的判断过程', () => {
  const { steps } = explain(tab(1, 'https://example.com/'), [devRule], {});
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0], {
    ruleId: 'dev-localhost',
    urlMatched: false,
    hit: false
  });
});
