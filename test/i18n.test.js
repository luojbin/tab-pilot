import test from 'node:test';
import assert from 'node:assert/strict';

import { setLanguage, t } from '../src/ui/i18n.js';

test('i18n：静态文案与模板切换到英文', () => {
  setLanguage('en');

  assert.equal(t('TabPilot 设置'), 'TabPilot Settings');
  assert.equal(t('保存并同步'), 'Save & sync');
  assert.equal(t('第 2 个 · 顺序即优先级'), 'Group 2 · order = priority');
  assert.equal(t('新分组 3'), 'New group 3');
  assert.equal(t('匹配路径 2'), 'Match pattern 2');
  assert.equal(
    t('保存成功，共 2 个分组；同步完成：归组 1 个，跳过 1 个，失败 0 个'),
    'Saved: 2 groups; sync done: 1 grouped, 1 skipped, 0 failed'
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
