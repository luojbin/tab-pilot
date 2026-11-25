import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { invalidRuleIndexes } from '../src/core/validation-errors.js';
import { validateConfig } from '../src/app/store.js';

test('错误定位：只取外层规则组，内层命名规则号不参与高亮', () => {
  assert.deepEqual(invalidRuleIndexes(['rules[2].titleRule.rules[0].titlePattern/urlPattern 至少填写一个正则']), [2]);
  assert.deepEqual(invalidRuleIndexes(['rules[0].titleRule.rules[2].replacement 必须是字符串']), [0]);
});

test('错误定位：旧重名提示仍能关联两个外层规则组', () => {
  assert.deepEqual(invalidRuleIndexes(['rules[2].name 重复：A（与 rules[0] 同名）']), [0, 2]);
});

test('错误定位：结构化位置独立于文案内容，忽略字符串中的伪路径', () => {
  assert.deepEqual(invalidRuleIndexes([
    { ruleIndex: 2, entryIndex: 0, message: '正则中含 rules[0]' },
    { ruleIndex: 2, relatedRuleIndexes: [1], message: '改写后的提示' },
    { message: '根配置错误，不应定位到 rules[0]' }
  ]), [1, 2]);
});

test('错误定位：支持其他字段、重复项、全局错误和空输入', () => {
  assert.deepEqual(invalidRuleIndexes(['rules[3].tabGroup.minTabs 必须是整数', 'rules[1].name 必须是字符串', 'rules[3].patterns[0] 无效', 'schemaVersion 错误']), [1, 3]);
  assert.deepEqual(invalidRuleIndexes(null), []);
  assert.deepEqual(invalidRuleIndexes([{ ruleIndex: -1 }, { ruleIndex: 1.5 }, { relatedRuleIndexes: {} }]), []);
});

test('设置页实际高亮：第 3 组空命名规则只标红第 3 组，重名继续标红双方', () => {
  const rules = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, name: `G${i}`, patterns: ['https://example.com/*'] }));
  rules[2].titleRule = { enabled: true, rules: [{ titlePattern: '', urlPattern: '', replacement: 'X' }] };
  const checked = validateConfig({ schemaVersion: 2, rules });
  assert.equal(checked.ok, false);
  const marked = new Set();
  const rows = rules.map((rule, index) => ({ dataset: { id: rule.id }, classList: {
    remove() { marked.delete(index); }, add() { marked.add(index); }
  }, scrollIntoView() {} }));
  const selected = [];
  const context = vm.createContext({ invalidRuleIndexes,
    els: { list: { querySelectorAll() { return rows; }, querySelector() { return rows.find((_, i) => marked.has(i)); } } },
    state: { rules, selectedId: 'r2' }, selectRule(id) { selected.push(id); }
  });
  const source = fs.readFileSync(new URL('../src/ui/options.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function markInvalid('), source.indexOf('async function sendSync(')), context);
  context.markInvalid(checked.errorDetails);
  assert.deepEqual([...marked], [2]);
  assert.deepEqual(selected, []);
  rules[2].titleRule.rules = [];
  rules[2].name = rules[0].name;
  context.markInvalid(validateConfig({ schemaVersion: 2, rules }).errorDetails);
  assert.deepEqual([...marked], [0, 2]);
  context.markInvalid([]);
  assert.deepEqual([...marked], []);
});
