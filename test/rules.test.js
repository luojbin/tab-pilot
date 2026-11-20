import test from 'node:test';
import assert from 'node:assert/strict';

import {
  match,
  explain,
  globToRegExp,
  minTabsOf,
  normalizeRules,
  rulePatterns,
  matchedPatternOf,
  hostHasPort,
  expandPattern,
  expandPatterns,
  DEFAULT_MIN_TABS
} from '../src/core/rules.js';

function tab(id, url, windowId = 1) {
  return { id, url, windowId, groupId: -1 };
}

function rule(id, patterns, extra) {
  return {
    id,
    enabled: true,
    name: id,
    color: 'blue',
    collapsed: false,
    minTabs: 1,
    note: '',
    patterns,
    ...(extra || {})
  };
}

const devRule = rule('dev-localhost', ['*://localhost:*/*'], { name: '开发', color: 'green' });
const codeRule = rule('code-github', ['*://*.github.com/*'], {
  name: '代码',
  color: 'blue',
  minTabs: 3
});
const fallbackRule = rule('zz-fallback', ['*://*/*'], { name: '其他', color: 'grey' });

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
  assert.equal(re.test('https://example.com/ab=1'), false);
});

test('globToRegExp：主机名 `*.` 前缀同时匹配裸域名与子域名', () => {
  const re = globToRegExp('*://*.github.com/*');
  assert.equal(re.test('https://github.com/'), true);
  assert.equal(re.test('https://github.com/user/repo'), true);
  assert.equal(re.test('https://www.github.com/a'), true);
  assert.equal(re.test('https://a.b.github.com/a'), true);
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

test('多路径：同一规则内任意一条匹配即命中', () => {
  const multi = rule('multi', ['*://gitlab.com/*', '*://gitee.com/*', '*://*.github.com/*'], {
    name: '代码'
  });

  assert.equal(match(tab(1, 'https://gitlab.com/a'), [multi], {}).ruleId, 'multi');
  assert.equal(match(tab(2, 'https://gitee.com/b'), [multi], {}).ruleId, 'multi');
  assert.equal(match(tab(3, 'https://gist.github.com/c'), [multi], {}).ruleId, 'multi');
  assert.equal(match(tab(4, 'https://example.com/'), [multi], {}), null);
});

test('matchedPatternOf：返回命中的那条路径', () => {
  const multi = rule('multi', ['*://gitlab.com/*', '*://gitee.com/*']);
  assert.equal(matchedPatternOf(multi, 'https://gitee.com/x'), '*://gitee.com/*');
  assert.equal(matchedPatternOf(multi, 'https://example.com/'), null);
});

test('rulePatterns：忽略空串与非法项', () => {
  assert.deepEqual(rulePatterns({ patterns: ['*://a/*', '', '   ', null, 3] }), ['*://a/*']);
  assert.deepEqual(rulePatterns({}), []);
  assert.deepEqual(rulePatterns(null), []);
});

test('顺序即优先级：靠前的规则先命中', () => {
  const broad = rule('broad', ['*://localhost:*/*'], { name: '宽泛' });
  const result = match(tab(1, 'http://localhost:3000/'), [devRule, broad], {});
  assert.equal(result.ruleId, 'dev-localhost');

  // 交换顺序后结果随之改变
  const reversed = match(tab(1, 'http://localhost:3000/'), [broad, devRule], {});
  assert.equal(reversed.ruleId, 'broad');
});

test('顺序即优先级：legacy priority 字段不再影响结果', () => {
  const lowFirst = { ...rule('low', ['*://example.com/*']), priority: 1 };
  const highSecond = { ...rule('high', ['*://example.com/*']), priority: 999 };
  assert.equal(match(tab(1, 'https://example.com/'), [lowFirst, highSecond], {}).ruleId, 'low');
});

test('enabled=false 的规则被跳过', () => {
  const disabled = { ...devRule, enabled: false };
  assert.equal(match(tab(1, 'http://localhost:3000/'), [disabled], {}), null);
});

test('没有匹配路径的规则被跳过', () => {
  const broken = rule('broken', []);
  assert.equal(match(tab(1, 'http://localhost:3000/'), [broken, devRule], {}).ruleId, 'dev-localhost');
});

test('match：旧 context.globalEnabled 不再影响规则匹配', () => {
  const result = explain(tab(1, 'http://localhost:3000/'), [devRule], { globalEnabled: false });
  assert.equal(result.matched.ruleId, devRule.id);
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
  assert.equal(result.rule.name, '代码');
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
  const result = explain(target, [codeRule], { tabs: [...sameWindow, target, otherWindow] });
  assert.equal(result.steps[0].count, 3);
});

test('explain：达成阈值时返回同窗口内命中的标签 id', () => {
  const tabs = [
    tab(1, 'https://www.github.com/a'),
    tab(2, 'https://gist.github.com/b'),
    tab(3, 'https://api.github.com/c'),
    tab(4, 'https://example.com/x'),
    tab(5, 'https://www.github.com/d', 2)
  ];
  const { matched } = explain(tabs[0], [codeRule], { tabs });
  assert.equal(matched.minTabs, 3);
  assert.deepEqual(matched.tabIds.slice().sort((a, b) => a - b), [1, 2, 3]);
});

test('explain：steps 记录命中的具体路径', () => {
  const multi = rule('multi', ['*://gitlab.com/*', '*://gitee.com/*']);
  const { steps } = explain(tab(1, 'https://gitee.com/x'), [multi], {});
  assert.equal(steps[0].pattern, '*://gitee.com/*');
  assert.equal(steps[0].hit, true);
});

test('minTabsOf：缺省与非法值回退到 1', () => {
  assert.equal(minTabsOf({}), DEFAULT_MIN_TABS);
  assert.equal(minTabsOf({ minTabs: 0 }), 1);
  assert.equal(minTabsOf({ minTabs: 2.5 }), 2);
  assert.equal(minTabsOf({ minTabs: '3' }), 3);
  assert.equal(minTabsOf({ minTabs: 4 }), 4);
});

test('normalizeRules：保持顺序并过滤不可用规则', () => {
  const rules = [
    rule('first', ['*://a/*']),
    { ...rule('disabled', ['*://b/*']), enabled: false },
    rule('no-pattern', []),
    rule('last', ['*://c/*'])
  ];
  assert.deepEqual(
    normalizeRules(rules).map((item) => item.id),
    ['first', 'last']
  );
});

test('expandPattern：只写 IP 时展开为“任意端口 + 无端口”', () => {
  assert.deepEqual(expandPattern('192.168.3.213'), [
    '*://192.168.3.213:*/*',
    '*://192.168.3.213/*'
  ]);
});

test('expandPattern：只写域名时同样展开两种形式', () => {
  assert.deepEqual(expandPattern('*.github.com'), [
    '*://*.github.com:*/*',
    '*://*.github.com/*'
  ]);
});

test('expandPattern：显式带端口时不再展开端口变体', () => {
  assert.deepEqual(expandPattern('localhost:3000'), ['*://localhost:3000/*']);
  assert.deepEqual(expandPattern('http://192.168.3.213:8080'), [
    'http://192.168.3.213:8080/*'
  ]);
});

test('expandPattern：带协议但没有路径时也展开两种端口形式', () => {
  assert.deepEqual(expandPattern('https://example.com'), [
    'https://example.com:*/*',
    'https://example.com/*'
  ]);
});

test('expandPattern：结尾自动补 `/*` 或 `*`', () => {
  assert.deepEqual(expandPattern('https://example.com/foo'), ['https://example.com/foo/*']);
  assert.deepEqual(expandPattern('https://example.com/foo/'), ['https://example.com/foo/*']);
  assert.deepEqual(expandPattern('https://example.com/'), ['https://example.com/*']);
});

test('expandPattern：完整模式保持不变（幂等）', () => {
  for (const pattern of ['https://example.com/*', '*://*.github.com/*', '*://192.168.3.213:*/*']) {
    assert.deepEqual(expandPattern(pattern), [pattern], `${pattern} 不应被改写`);
  }
  const once = expandPattern('192.168.3.213');
  for (const pattern of once) {
    assert.deepEqual(expandPattern(pattern), [pattern]);
  }
});

test('expandPattern：协议相对写法与空输入', () => {
  assert.deepEqual(expandPattern('//example.com'), [
    '*://example.com:*/*',
    '*://example.com/*'
  ]);
  assert.deepEqual(expandPattern(''), []);
  assert.deepEqual(expandPattern('   '), []);
  assert.deepEqual(expandPattern('http://'), []);
  assert.deepEqual(expandPattern(null), []);
});

test('expandPattern：IPv6 主机带端口时按显式端口处理', () => {
  assert.equal(hostHasPort('[::1]:3000'), true);
  assert.equal(hostHasPort('[::1]'), false);
  assert.equal(hostHasPort('example.com'), false);
  assert.deepEqual(expandPattern('[::1]:3000'), ['*://[::1]:3000/*']);
});

test('expandPatterns：批量展开并去重', () => {
  assert.deepEqual(expandPatterns(['192.168.3.213', '192.168.3.213', '']), [
    '*://192.168.3.213:*/*',
    '*://192.168.3.213/*'
  ]);
  assert.deepEqual(expandPatterns(undefined), []);
});

test('expandPattern：展开结果能被规则引擎匹配（IP 任意端口/无端口）', () => {
  const patterns = expandPattern('192.168.3.213');
  const ipRule = rule('lan', patterns, { name: '内网' });

  assert.equal(match(tab(1, 'http://192.168.3.213/'), [ipRule], {}).ruleId, 'lan');
  assert.equal(match(tab(2, 'http://192.168.3.213:8080/admin'), [ipRule], {}).ruleId, 'lan');
  assert.equal(match(tab(3, 'https://192.168.3.214/'), [ipRule], {}), null);
});
