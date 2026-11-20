import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarFeedback } from '../src/core/toolbar-feedback.js';

test('工具栏提示：中英、折叠、暂停和失败结果', () => {
  assert.equal(toolbarFeedback({}, 'zh'), 'TabPilot：同步完成');
  for (const action of ['syncRuleCollapse','syncCollapseInactive','syncCollapseAll']) {
    const message = toolbarFeedback({ action, collapsed: 2, failed: 1 }, 'en');
    assert.match(message, /Sync complete/);
    assert.match(message, /2/);
    assert.match(message, /1 failed/);
  }
  assert.match(toolbarFeedback({ paused: true }, 'zh'), /全局已暂停/);
  assert.match(toolbarFeedback({}, 'en', true), /Action failed/);
});

