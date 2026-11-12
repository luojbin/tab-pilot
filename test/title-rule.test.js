const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TITLE_RULE,
  normalizeTitleRule,
  compileEntry,
  applyTitleRules,
  applyTitleBatch
} = require('../src/title-rule.js');

function spec(rules, extras) {
  return {
    titleRule: {
      enabled: true,
      rules,
      testText: '',
      ...(extras || {})
    }
  };
}

const JIRA = { pattern: '^\\[(.*?)\\]\\s*(.*)$', replacement: '$2 · $1', description: '' };

test('normalizeTitleRule：缺省时给出关闭状态和空规则组', () => {
  assert.deepEqual(normalizeTitleRule({}), DEFAULT_TITLE_RULE);
  assert.deepEqual(normalizeTitleRule(null), DEFAULT_TITLE_RULE);
  assert.equal(normalizeTitleRule({}).enabled, false);
  assert.deepEqual(normalizeTitleRule({}).rules, []);
});

test('normalizeTitleRule：兼容 v4 的单条正则写法', () => {
  const spec = normalizeTitleRule({
    titleRule: { enabled: true, pattern: 'a', replacement: 'b' }
  });
  assert.equal(spec.enabled, true);
  assert.equal(spec.rules.length, 1);
  assert.equal(spec.rules[0].pattern, 'a');
  assert.equal(spec.rules[0].replacement, 'b');
  assert.equal(spec.rules[0].description, '');
});

test('normalizeTitleRule：旧的 prefix 字段折算进目标文本（含 $ 转义）', () => {
  const spec = normalizeTitleRule({
    titleRule: {
      enabled: true,
      rules: [{ pattern: 'a', replacement: '$1', prefix: '[$] ' }]
    }
  });
  // 前缀里的 $ 需要转义，否则会被当成替换占位符
  assert.equal(spec.rules[0].replacement, '[$$] $1');
});

test('normalizeTitleRule：字段只接受字符串', () => {
  const spec = normalizeTitleRule({
    titleRule: { enabled: 1, testText: 42, rules: [{ pattern: 7, replacement: null, description: {} }] }
  });
  assert.equal(spec.enabled, false);
  assert.equal(spec.testText, '');
  assert.deepEqual(spec.rules[0], { pattern: '', replacement: '', description: '' });
});

test('compileEntry：空正则与非法正则分别报告原因', () => {
  assert.equal(compileEntry({ pattern: '   ' }).reason, 'empty-pattern');
  const invalid = compileEntry({ pattern: '([' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-regex');
  assert.ok(invalid.error);
});

test('applyTitleRules：按顺序匹配，命中第一条就停止', () => {
  const rule = spec([
    { pattern: '^\\[工作\\]', replacement: 'W· 工作项', description: '' },
    { pattern: '^\\[', replacement: '其他', description: '' }
  ]);
  const first = applyTitleRules(rule, '[工作] Jira - 看板');
  assert.equal(first.matched, true);
  assert.equal(first.ruleIndex, 0);
  assert.equal(first.result, 'W· 工作项 Jira - 看板');

  // 第一条不命中时才轮到第二条
  const second = applyTitleRules(rule, '[代码] GitHub');
  assert.equal(second.ruleIndex, 1);
  assert.equal(second.result, '其他代码] GitHub');
});

test('applyTitleRules：支持捕获组重排与命名组', () => {
  const reorder = applyTitleRules(spec([JIRA]), '[工作] Jira - 看板');
  assert.equal(reorder.result, 'Jira - 看板 · 工作');

  const named = applyTitleRules(
    spec([{ pattern: '^(?<site>\\w+) - (?<page>.+)$', replacement: '$<page> · $<site>' }]),
    'jira - 看板'
  );
  assert.equal(named.result, '看板 · jira');
});

test('applyTitleRules：需要前缀时直接写进目标文本', () => {
  const outcome = applyTitleRules(
    spec([{ pattern: '^Jira', replacement: '[工作] Jira' }]),
    'Jira 看板'
  );
  assert.equal(outcome.result, '[工作] Jira 看板');
});

test('applyTitleRules：非法正则被跳过，后面的规则仍可命中', () => {
  const outcome = applyTitleRules(
    spec([
      { pattern: '([', replacement: 'bad' },
      { pattern: 'jira', replacement: 'JIRA' }
    ]),
    'jira board'
  );
  assert.equal(outcome.matched, true);
  assert.equal(outcome.ruleIndex, 1);
  assert.equal(outcome.result, 'JIRA board');
});

test('applyTitleRules：全部非法正则时报告 invalid-regex 并保持原文', () => {
  const outcome = applyTitleRules(spec([{ pattern: '([' }]), 'x');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.matched, false);
  assert.equal(outcome.reason, 'invalid-regex');
  assert.equal(outcome.result, 'x');
});

test('applyTitleRules：未命中 / 未启用 / 空规则组', () => {
  assert.equal(applyTitleRules(spec([{ pattern: '^nope$' }]), 'x').reason, 'no-match');
  assert.equal(applyTitleRules({ titleRule: { enabled: false } }, 'x').reason, 'disabled');
  assert.equal(applyTitleRules(spec([]), 'x').reason, 'no-rules');
});

test('applyTitleRules：只替换第一个匹配', () => {
  const outcome = applyTitleRules(spec([{ pattern: 'a', replacement: 'b' }]), 'aaa');
  assert.equal(outcome.result, 'baa');
});

test('applyTitleBatch：逐行处理，跳过空行', () => {
  const rows = applyTitleBatch(spec([JIRA]), '[工作] Jira - 看板\n\n[代码] GitHub - PR\n普通标题');
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
