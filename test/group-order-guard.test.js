import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupOrderGuard } from '../src/app/group-order-guard.js';

test('手动新建群组命名时保护整个窗口，连续输入和停顿都不移动，页面交互才放行', () => {
  const ready = [];
  const guard = createGroupOrderGuard(windowId => ready.push(windowId));
  guard.created({ id: 7, windowId: 1, title: '' });
  assert.equal(guard.shouldDefer(1), true);
  assert.equal(guard.shouldDefer(2), false);
  guard.updated({ id: 7, windowId: 1, title: '工' });
  guard.updated({ id: 7, windowId: 1, title: '工作' });
  assert.equal(guard.shouldDefer(1), true);
  assert.deepEqual(ready, []);
  guard.interaction(2);
  assert.equal(guard.shouldDefer(1), true);
  guard.interaction(1);
  assert.equal(guard.shouldDefer(1), false);
  assert.deepEqual(ready, [1]);
  guard.interaction(1);
  assert.deepEqual(ready, [1], '普通点击不反复触发整理');
});

test('已有群组改名也要等待交互，颜色及折叠更新不误判为命名', () => {
  const guard = createGroupOrderGuard(() => {});
  guard.prime([{ id: 7, windowId: 1, title: 'Work' }]);
  guard.automatic(7, 1, 'Work');
  guard.updated({ id: 7, windowId: 1, title: 'Work', color: 'red', collapsed: true });
  assert.equal(guard.isEditing(1), false);
  guard.updated({ id: 7, windowId: 1, title: 'Personal' });
  assert.equal(guard.isEditing(1), true);
  guard.interaction(1);
  assert.equal(guard.isEditing(1), false);
});

test('自动规则完成命名后可立即前置，晚到的创建事件不重新锁住窗口', () => {
  const guard = createGroupOrderGuard(() => {});
  guard.created({ id: 7, windowId: 1, title: '' });
  guard.updated({ id: 7, windowId: 1, title: 'Work' });
  guard.automatic(7, 1, 'Work');
  assert.equal(guard.shouldDefer(1), false);
  guard.created({ id: 7, windowId: 1, title: '' });
  guard.updated({ id: 7, windowId: 1, title: 'Work' });
  assert.equal(guard.shouldDefer(1), false);
  guard.updated({ id: 7, windowId: 1, title: 'My work' });
  assert.equal(guard.shouldDefer(1), true);
});

test('删除待命名群组解除保护，其他待命名组仍能阻止同窗口移动', () => {
  const ready = [];
  const guard = createGroupOrderGuard(windowId => ready.push(windowId));
  guard.created({ id: 7, windowId: 1, title: '' });
  guard.created({ id: 8, windowId: 1, title: '' });
  guard.removed({ id: 7, windowId: 1 });
  assert.equal(guard.shouldDefer(1), true);
  assert.deepEqual(ready, []);
  guard.removed({ id: 8, windowId: 1 });
  assert.equal(guard.shouldDefer(1), false);
  assert.deepEqual(ready, [1]);
});


test('后台休眠重建后保留待整理窗口，已关闭群组不恢复，点击后清空状态', () => {
  const original = createGroupOrderGuard(() => {});
  original.created({ id: 7, windowId: 1, title: '' });
  original.updated({ id: 7, windowId: 1, title: 'Work' });
  const ready = [];
  const restored = createGroupOrderGuard(windowId => ready.push(windowId));
  const live = [{ id: 7, windowId: 1, title: 'Work' }];
  restored.prime(live);
  restored.restore([...original.snapshot(), { id: 8, windowId: 2 }], live);
  assert.equal(restored.shouldDefer(1), true);
  assert.equal(restored.shouldDefer(2), false);
  assert.equal(restored.activationCanFinish({ groupId: 7 }), true);
  restored.interaction(1);
  assert.deepEqual(restored.snapshot(), []);
  assert.deepEqual(ready, [1]);
});

test('后台刚被改名事件唤醒，基线已是新名字时仍等待交互', () => {
  const guard = createGroupOrderGuard(() => {});
  guard.prime([{ id: 7, windowId: 1, title: '刚输入的新名称' }]);
  guard.updated({ id: 7, windowId: 1, title: '刚输入的新名称' });
  assert.equal(guard.shouldDefer(1), true);
  guard.interaction(1);
  assert.equal(guard.shouldDefer(1), false);
});
