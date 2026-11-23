import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TITLE_RULE,
  normalizeTitleRule,
  compileEntry,
  stripPatternAnchors,
  applyTitleRules,
  applyTitleBatch
} from '../src/core/title-rule.js';

function spec(rules, extras) {
  return {
    titleRule: {
      enabled: true,
      rules,
      testCases: [],
      ...(extras || {})
    }
  };
}

const JIRA = { titlePattern: '^\\[(.*?)\\]\\s*(.*)$', replacement: '$2 · $1', description: '' };

test('normalizeTitleRule：缺省时给出关闭状态和空规则组', () => {
  assert.deepEqual(normalizeTitleRule({}), DEFAULT_TITLE_RULE);
  assert.deepEqual(normalizeTitleRule(null), DEFAULT_TITLE_RULE);
  assert.equal(normalizeTitleRule({}).enabled, false);
  assert.deepEqual(normalizeTitleRule({}).rules, []);
});

test('normalizeTitleRule：旧单条写法不再兼容（只认 rules 数组）', () => {
  const spec = normalizeTitleRule({
    titleRule: { enabled: true, titlePattern: 'a.*', replacement: 'b' }
  });
  assert.equal(spec.enabled, true);
  assert.deepEqual(spec.rules, []);
});

test('normalizeTitleRule：字段只接受字符串', () => {
  const spec = normalizeTitleRule({
    titleRule: { enabled: 1, testCases: 42, rules: [{ titlePattern: 7, replacement: null, description: {} }] }
  });
  assert.equal(spec.enabled, false);
  assert.deepEqual(spec.testCases, []);
  assert.deepEqual(spec.rules[0], { titlePattern: '', urlPattern: '', replacement: '', description: '' });
});

test('compileEntry：空正则与非法正则分别报告原因', () => {
  assert.equal(compileEntry({ titlePattern: '   ' }).reason, 'empty-pattern');
  const invalid = compileEntry({ titlePattern: '([' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-regex');
  assert.ok(invalid.error);
});

test('applyTitleRules：按顺序匹配，命中第一条就停止', () => {
  const rule = spec([
    { titlePattern: '\\[工作\\].*', replacement: 'W· 工作项', description: '' },
    { titlePattern: '\\[.*', replacement: '其他', description: '' }
  ]);
  const first = applyTitleRules(rule, '[工作] Jira - 看板');
  assert.equal(first.matched, true);
  assert.equal(first.ruleIndex, 0);
  assert.equal(first.result, 'W· 工作项');

  // 第一条不命中时才轮到第二条
  const second = applyTitleRules(rule, '[代码] GitHub');
  assert.equal(second.ruleIndex, 1);
  assert.equal(second.result, '其他');
});

test('applyTitleRules：支持捕获组重排与命名组', () => {
  const reorder = applyTitleRules(spec([JIRA]), '[工作] Jira - 看板');
  assert.equal(reorder.result, 'Jira - 看板 · 工作');

  const named = applyTitleRules(
    spec([{ titlePattern: '^(?<site>\\w+) - (?<page>.+)$', replacement: '$<page> · $<site>' }]),
    'jira - 看板'
  );
  assert.equal(named.result, '看板 · jira');
});

test('applyTitleRules：需要前缀时直接写进目标文本', () => {
  const outcome = applyTitleRules(
    spec([{ titlePattern: 'Jira.*', replacement: '[工作] Jira' }]),
    'Jira 看板'
  );
  assert.equal(outcome.result, '[工作] Jira');
});

test('applyTitleRules：非法正则被跳过，后面的规则仍可命中', () => {
  const outcome = applyTitleRules(
    spec([
      { titlePattern: '([', replacement: 'bad' },
      { titlePattern: 'jira.*', replacement: 'JIRA' }
    ]),
    'jira board'
  );
  assert.equal(outcome.matched, true);
  assert.equal(outcome.ruleIndex, 1);
  assert.equal(outcome.result, 'JIRA');
});

test('applyTitleRules：全部非法正则时报告 invalid-regex 并保持原文', () => {
  const outcome = applyTitleRules(spec([{ titlePattern: '([' }]), 'x');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.matched, false);
  assert.equal(outcome.reason, 'invalid-regex');
  assert.equal(outcome.result, 'x');
});

test('applyTitleRules：未命中 / 未启用 / 空规则组', () => {
  assert.equal(applyTitleRules(spec([{ titlePattern: '^nope$' }]), 'x').reason, 'no-match');
  assert.equal(applyTitleRules({ titleRule: { enabled: false } }, 'x').reason, 'disabled');
  assert.equal(applyTitleRules(spec([]), 'x').reason, 'no-rules');
});

test('applyTitleRules：完整标题命中后将 replacement 作为完整新标题', () => {
  const outcome = applyTitleRules(spec([{ titlePattern: 'a.*', replacement: 'b' }]), 'aaa');
  assert.equal(outcome.result, 'b');
  assert.equal(applyTitleRules(spec([{ titlePattern: 'a.*', replacement: '' }]), 'aaa').result, '');
});

test('applyTitleBatch：逐行处理，跳过空行', () => {
  const rows = applyTitleBatch(spec([JIRA]), [{ title: '[工作] Jira - 看板', url: '' }, { title: '[代码] GitHub - PR', url: '' }, { title: '普通标题', url: '' }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.source),
    ['[工作] Jira - 看板', '[代码] GitHub - PR', '普通标题']
  );
  assert.equal(rows[0].result, 'Jira - 看板 · 工作');
  assert.equal(rows[1].result, 'GitHub - PR · 代码');
  assert.equal(rows[2].matched, false);
  assert.equal(rows[2].reason, 'no-match');
});

test('applyTitleBatch：空文本返回空数组', () => {
  assert.deepEqual(applyTitleBatch(spec([JIRA]), ''), []);
  assert.deepEqual(applyTitleBatch(spec([JIRA]), '   \n  '), []);
});

test('双来源捕获：数字、命名和完整匹配可同时引用，捕获中的 $ 不二次展开', () => {
  const rule = spec([{ titlePattern: '^(?<label>.+)$', urlPattern: 'https://host/(?<project>[^/]+)/([0-9]+)$',
    replacement: '${title.label} / ${url.project} #${url.2} · ${url.0} · ${title.0} $$' }]);
  assert.equal(applyTitleRules(rule, 'App $1', 'https://host/acme/42').result,
    'App $1 / acme #42 · https://host/acme/42 · App $1 $');
});

test('双条件必须同时命中；URL-only 替换整个标题', () => {
  const rule = spec([
    { titlePattern: '^App$', urlPattern: 'https://host/work/(.+)$', replacement: '${url.1}' },
    { urlPattern: 'https://host/other/(.+)$', replacement: '${url.1}: ${title.0}' }
  ]);
  assert.equal(applyTitleRules(rule, 'App', 'https://host/work/42').result, '42');
  assert.equal(applyTitleRules(rule, 'Else', 'https://host/work/42').matched, false);
  assert.equal(applyTitleRules(rule, 'App', 'https://host/nope').matched, false);
  assert.equal(applyTitleRules(rule, 'Else', 'https://host/other/abc').result, 'abc: Else');
});

test('捕获缺省、模板转义、捕获生成完整标题及旧模板语法', () => {
  const rule = spec([{ titlePattern: '(a)(b)?', urlPattern: 'https://host/(x)?$',
    replacement: '${title.2}/${url.1}/${title.unknown}/${url.99}/$${url.1}/$1/$12/$&' }]);
  assert.equal(applyTitleRules(rule, 'a', 'https://host/').result, '////${url.1}/a/a2/a');
});

test('URL 正则非法被跳过；结构化测试保留空标题和标题空格', () => {
  const rule = spec([{ urlPattern: '[', replacement: 'bad' },
    { urlPattern: 'https://host/(42)$', replacement: '${url.1}: ${title.0}' }]);
  const rows = applyTitleBatch(rule, [{ title: '', url: 'https://host/42' }, { title: ' App ', url: 'https://host/42' }]);
  assert.equal(rows[0].result, '42: ');
  assert.equal(rows[1].result, '42:  App ');
  assert.equal(rows[1].ruleIndex, 1);
});

test('schema 1 迁移后的模板完整标题匹配时保留旧模板语法，包括原有字面量 scoped 模板', async () => {
  const { migrateConfig } = await import('../src/core/config-migration.js');
  const title = 'abc';
  const pattern = '(?<first>a)(b)(c)?';
  for (const replacement of ['$1/$2/$12/$01/$99/$0', "$<first>/$<missing>/$&/$$/$`/$'", '${title.1}/${url.1}/$${url.1}/$$${url.1}', '$', '$$$', '']) {
    const migrated = migrateConfig({ schemaVersion: 1, rules: [spec([{ pattern, replacement }])] });
    assert.equal(applyTitleRules(migrated.rules[0], title).result, title.replace(new RegExp(pattern), replacement));
  }
});

test('隐含边界：标题必须完整命中，分支也不能局部命中，捕获编号保持不变', () => {
  const rule = spec([{ titlePattern: '(App)|(Portal)', replacement: '${title.1}${title.2}' }]);
  assert.equal(applyTitleRules(rule, 'App').result, 'App');
  assert.equal(applyTitleRules(rule, 'Portal').result, 'Portal');
  for (const title of ['prefix App', 'Portal suffix', 'App\n']) {
    assert.equal(applyTitleRules(rule, title).matched, false, JSON.stringify(title));
  }
});

test('URL 默认完整匹配，显式 .* 才允许后续路径、查询或片段', () => {
  for (const pattern of ['https://test\\.aaa\\.com/(hello)', '^https://test\\.aaa\\.com/(hello)$']) {
    const rule = spec([{ urlPattern: pattern, replacement: '${url.1}' }]);
    const wildcardRule = spec([{ urlPattern: pattern.replace(/\$$/, '') + '.*', replacement: '${url.1}' }]);
    assert.equal(applyTitleRules(rule, '123', 'https://test.aaa.com/hello').result, 'hello');
    for (const suffix of ['?id=42', '#section', '/next?key=value', '-world']) {
      const url = 'https://test.aaa.com/hello' + suffix;
      assert.equal(applyTitleRules(rule, '123', url).matched, false, url);
      assert.equal(applyTitleRules(wildcardRule, '123', url).result, 'hello');
    }
    assert.equal(applyTitleRules(rule, '123', 'https://other/https://test.aaa.com/hello').matched, false);
  }
});

test('边界归一化保留转义美元和反斜杠，显式标题边界与隐含边界等价', () => {
  assert.equal(stripPatternAnchors('^(App)$'), '(App)');
  assert.equal(stripPatternAnchors(String.raw`^Price (42)\$$`), String.raw`Price (42)\$`);
  for (const titlePattern of ['Price (42)\\$', '^Price (42)\\$$']) {
    assert.equal(applyTitleRules(spec([{ titlePattern, replacement: '${title.1}' }]), 'Price 42$').result, '42');
  }
  for (const titlePattern of ['(App)', '^(App)$']) {
    assert.equal(applyTitleRules(spec([{ titlePattern, replacement: '${title.1}!' }]), 'App').result, 'App!');
  }
  assert.equal(compileEntry({ titlePattern: 'abc\\' }).reason, 'invalid-regex');
  assert.equal(compileEntry({ titlePattern: String.raw`foo\\$` }).titleRegex.test('foo\\'), true);
});

test('同一个正则用于标题和 URL 时均为完整匹配，显式通配符单独缓存', () => {
  const titleRule = spec([{ titlePattern: 'https://host/item', replacement: 'matched' }]);
  const urlRule = spec([{ urlPattern: 'https://host/item', replacement: 'matched' }]);
  assert.equal(applyTitleRules(titleRule, 'https://host/item?x=1').matched, false);
  assert.equal(applyTitleRules(urlRule, 'App', 'https://host/item?x=1').matched, false);
  assert.equal(applyTitleRules(urlRule, 'App', 'https://host/item').result, 'matched');
  const wildcard = spec([{ urlPattern: 'https://host/item.*', replacement: 'matched' }]);
  assert.equal(applyTitleRules(wildcard, 'App', 'https://host/item?x=1').result, 'matched');
  assert.equal(applyTitleRules(urlRule, 'App', 'https://host/item?x=1').matched, false);
});
