import test from 'node:test';
import assert from 'node:assert/strict';

import { setLanguage, t } from '../src/ui/i18n.js';

test('i18n：静态文案与模板切换到英文', () => {
  setLanguage('en');

  assert.equal(t('TabPilot 设置'), 'TabPilot Settings');
  assert.equal(t('规则组'), 'Rule groups');
  assert.equal(t('规则组名'), 'Rule group name');
  assert.equal(t('标签页群组前置'), 'Groups first');
  assert.equal(t('保存并同步'), 'Save & sync');
  assert.equal(t('第 2 个 · 顺序即优先级'), 'Rule group 2 · order = priority');
  assert.equal(t('新规则组 3'), 'New rule group 3');
  assert.equal(t('匹配路径 2'), 'Match pattern 2');
  assert.equal(
    t('保存成功，共 2 个规则组；同步完成：归组 1 个，跳过 1 个，失败 0 个'),
    'Saved: 2 rule groups; sync done: 1 grouped, 1 skipped, 0 failed'
  );
});

test('i18n：切换回中文保持原文', () => {
  setLanguage('en');
  assert.equal(t('保存并同步'), 'Save & sync');

  setLanguage('zh');
  assert.equal(t('保存并同步'), '保存并同步');
});

test('i18n：未知文本和用户数据不被改写', () => {
  setLanguage('en');
  assert.equal(t('开发环境'), '开发环境');
  assert.equal(t('localhost:3000'), 'localhost:3000');
});

test('命名规则错误：规则组、条目序号与具体原因均能切换中英文', () => {
  setLanguage('en');
  assert.equal(t('规则组“工作”的第 1 条命名规则：标题条件和 URL 条件至少填写一个正则'),
    'Rule group “工作”, title rule 1: Enter at least one title or URL regular expression');
  assert.equal(t('规则组“工作”的第 2 条命名规则：URL 条件不是合法的正则：Invalid regular expression'),
    'Rule group “工作”, title rule 2: URL condition is not a valid regex: Invalid regular expression');
  assert.equal(t('规则组“全局配置”的第 4 条命名规则：目标文本必须是字符串'),
    'Rule group “全局配置”, title rule 4: Replacement must be a string');
  setLanguage('zh');
  const text = '规则组“工作”的第 1 条命名规则：标题条件和 URL 条件至少填写一个正则';
  assert.equal(t(text), text);
});
