import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.browser = {};
const { startPopup } = await import('../src/ui/popup.js');

function fixture(response = { ok: true, text: '同步完成' }) {
  const elements = Object.fromEntries(['panel','status','settings'].map(id => [id, {
    textContent: '', handlers: {}, classList: { add(value) { this.value = value; }, remove() { this.value = ''; } },
    addEventListener(name, fn) { this.handlers[name] = fn; }
  }]));
  const pending = new Map();
  let sequence = 0;
  let closed = 0;
  let opened = 0;
  const messages = [];
  const view = { setTimeout(fn,ms) { const id = ++sequence; pending.set(id,{fn,ms}); return id; }, clearTimeout(id) { pending.delete(id); }, close() { closed++; } };
  const doc = { documentElement: {}, getElementById(id) { return elements[id]; } };
  const api = { windows: { async getCurrent() { return {id: 7}; } }, runtime: {
    async sendMessage(message) { messages.push(message); if (response instanceof Error) throw response; return response; },
    async openOptionsPage() { opened++; }
  } };
  const run = () => startPopup(api,doc,view,async () => ({ config: { language: 'zh' } }));
  return {elements,pending,view,doc,api,messages,run,get closed() {return closed;},get opened() {return opened;}};
}

test('popup：只执行一次，显示结果 3 秒，淡出后关闭', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.messages,[{type:'toolbar-execute',windowId:7}]);
  assert.equal(f.elements.status.textContent,'同步完成');
  assert.equal(f.elements.settings.textContent,'设置');
  const fade = [...f.pending.entries()][0];
  assert.equal(fade[1].ms,3000);
  f.pending.delete(fade[0]); fade[1].fn();
  assert.equal(f.elements.panel.classList.value,'fading');
  const close = [...f.pending.values()][0];
  assert.equal(close.ms,300);
  close.fn();
  assert.equal(f.closed,1);
});

test('popup：设置交互取消计时，打开配置页后关闭', async () => {
  const f = fixture();
  await f.run();
  f.elements.panel.handlers.keydown();
  assert.equal(f.pending.size,0);
  await f.elements.settings.handlers.click();
  assert.equal(f.opened,1);
  assert.equal(f.closed,1);
});

test('popup：后台通信失败显示失败信息', async () => {
  const f = fixture(new Error('No receiver'));
  await f.run();
  assert.match(f.elements.status.textContent,/操作失败/);
  assert.equal(f.elements.status.className,'error');
});
