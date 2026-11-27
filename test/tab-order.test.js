import test from 'node:test';
import assert from 'node:assert/strict';

let tabs = [];
let calls = [];
let failWindow;
globalThis.browser = {
  tabs: {
    async query(scope = {}) { return tabs.filter(tab => scope.windowId === undefined || tab.windowId === scope.windowId).map(tab => ({ ...tab })); },
    async move() { throw new Error('不得逐标签移动，Firefox 可能将游离标签并入分组'); }
  },
  tabGroups: {
    async move(groupId, options) {
      calls.push({ groupId, ...options });
      if (options.windowId === failWindow) throw new Error('window closed');
      const current = tabs.filter(tab => tab.windowId === options.windowId).sort((a,b) => a.index-b.index);
      const moving = current.filter(tab => tab.groupId === groupId);
      const rest = current.filter(tab => tab.groupId !== groupId);
      assert.ok(options.index >= current.filter(tab => tab.pinned).length);
      assert.ok(!rest[options.index] || options.index === 0 || rest[options.index].groupId === -1 || rest[options.index - 1].groupId !== rest[options.index].groupId);
      rest.splice(options.index, 0, ...moving);
      rest.forEach((tab, index) => { tab.index = index; });
      return { id: groupId };
    }
  }
};
const { groupsFirst } = await import('../src/app/tab-order.js');
const tab = (id, index, groupId = -1, pinned = false, windowId = 1) => ({ id, index, groupId, pinned, windowId });

test('分组前置：整组移动，固定标签及游离标签不变，重复整理无操作', async () => {
  // 最后一个标签属于分组，覆盖 Firefox 原先将游离标签并入末组的场景。
  tabs = [tab(1,0,-1,true),tab(2,1),tab(3,2,7),tab(4,3,7),tab(5,4),tab(6,5,8)];
  calls = [];
  failWindow = undefined;
  const membership = tabs.map(t => [t.id,t.groupId]);
  assert.deepEqual(await groupsFirst(), { moved: 3, failed: 0 });
  assert.deepEqual(calls, [{ groupId: 7, windowId: 1, index: 1 },{ groupId: 8, windowId: 1, index: 3 }]);
  assert.deepEqual(tabs.slice().sort((a,b) => a.index-b.index).map(t => t.id), [1,3,4,6,2,5]);
  assert.deepEqual(tabs.map(t => [t.id,t.groupId]), membership);
  assert.deepEqual(await groupsFirst(), { moved: 0, failed: 0 });
  assert.equal(calls.length, 2);
});

test('分组前置：失败停止当前窗口，其他窗口继续', async () => {
  tabs = [tab(1,0),tab(2,1,4),tab(5,2,6),tab(3,0,-1,false,2),tab(4,1,5,false,2)];
  calls = [];
  failWindow = 1;
  assert.deepEqual(await groupsFirst(), { moved: 1, failed: 1 });
  assert.deepEqual(calls, [{ groupId: 4, windowId: 1, index: 0 },{ groupId: 5, windowId: 2, index: 0 }]);
});

test('分组前置：无分组或已排好时不移动', async () => {
  for (const list of [[],[tab(1,0,-1,true),tab(2,1)],[tab(1,0,3),tab(2,1)]]) {
    tabs = list;
    calls = [];
    assert.deepEqual(await groupsFirst(), { moved: 0, failed: 0 });
    assert.deepEqual(calls, []);
  }
});

test('分组前置：已在前面的组不移动，其余组保持原有顺序', async () => {
  tabs = [tab(1,0,-1,true),tab(2,1,3),tab(3,2),tab(4,3,4),tab(5,4),tab(6,5,5),tab(7,6)];
  calls = [];
  failWindow = undefined;
  assert.deepEqual(await groupsFirst(), { moved: 2, failed: 0 });
  assert.deepEqual(calls.map(c => c.groupId), [4,5]);
  assert.deepEqual(tabs.slice().sort((a,b) => a.index-b.index).map(t => t.id), [1,2,4,6,3,5,7]);
});


test('分组前置：可只整理指定窗口，其他窗口顺序不变',async()=>{
  tabs=[tab(1,0),tab(2,1,4),tab(3,0,-1,false,2),tab(4,1,5,false,2)];
  calls=[];failWindow=undefined;
  assert.deepEqual(await groupsFirst({windowId:1}),{moved:1,failed:0});
  assert.deepEqual(calls,[{groupId:4,windowId:1,index:0}]);
  assert.equal(tabs.find(tab=>tab.id===4).index,1);
});


test('命名保护跳过整个窗口，其他窗口仍可前置', async () => {
  tabs = [tab(1,0), tab(2,1,4), tab(3,0,-1,false,2), tab(4,1,5,false,2)];
  calls = []; failWindow = undefined;
  assert.deepEqual(await groupsFirst({ shouldDeferWindow: id => id === 1 }), { moved: 1, failed: 0 });
  assert.deepEqual(calls, [{ groupId: 5, windowId: 2, index: 0 }]);
  assert.equal(tabs.find(tab => tab.id === 2).index, 1);
});
