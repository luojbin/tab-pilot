import test from 'node:test';
import assert from 'node:assert/strict';
import { copyRule } from '../src/core/copy-rule.js';
import { colorForIndex } from '../src/app/store.js';

const source = {
  id: 'dev', name: '开发', enabled: true, color: 'green', minTabs: 3,
  collapsed: true, strictMode: true, note: '环境', patterns: ['*://localhost/*'],
  highlight: { enabled: true, border: { sides: ['top'] } },
  titleRule: { enabled: true, rules: [{ titlePattern: '^x', urlPattern: '/(42)$', replacement: '${url.1}' }], testCases: [{ title: 'x', url: 'https://host/42' }] }
};

test('复制规则：保留路径，按新序号取色且停用，嵌套数据独立', () => {
  const before = structuredClone(source);
  const copy = copyRule(source, [source], 'copy', '副本', colorForIndex(1));
  assert.deepEqual(copy, { ...before, id: 'copy', name: '开发（副本）', enabled: false, color: colorForIndex(1) });
  copy.patterns[0] = '*://staging.localhost/*';
  copy.highlight.border.sides.push('bottom');
  copy.titleRule.rules[0].replacement = 'changed';
  assert.deepEqual(source, before);
});

test('复制规则：跳过已有名称，生成唯一名称', () => {
  const rules = [source, { id: 'a', name: '开发（副本）' }, { id: 'b', name: ' 开发（副本 2） ' }];
  assert.equal(copyRule(source, rules, 'copy').name, '开发（副本 3）');
  assert.equal(copyRule(source, rules, 'copy', 'Copy').name, '开发（Copy）');
});

test('复制规则：拒绝重复或空 id，不为缺省配置添加字段', () => {
  assert.throws(() => copyRule(source, [source], 'dev'));
  assert.throws(() => copyRule(source, [source], ''));
  const copy = copyRule({ id: 'a', name: 'A', patterns: ['a'] }, [], 'b');
  assert.equal(Object.hasOwn(copy, 'highlight'), false);
  assert.equal(Object.hasOwn(copy, 'titleRule'), false);
});

test('复制规则：追加序号沿用新建规则的循环取色', () => {
  for (const count of [1, 8, 9, 10, 18]) {
    const rules = Array.from({ length: count }, (_, index) => ({ id: `r${index}`, name: `R${index}` }));
    const copy = copyRule(source, rules, 'copy', '副本', colorForIndex(rules.length));
    rules.push(copy);
    assert.equal(rules.at(-1), copy);
    assert.equal(copy.color, colorForIndex(count));
    assert.deepEqual(copy.patterns, source.patterns);
  }
});
