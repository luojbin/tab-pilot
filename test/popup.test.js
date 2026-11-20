import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.browser = {};
const { startPopup } = await import('../src/ui/popup.js');

function fixture(response = { ok: true, text: '同步完成' }) {
  const elements = Object.fromEntries(['panel','status','settings','ruleForm','question','pattern','patternLabel','addPattern','cancelPattern'].map(id => [id, {
    textContent: '', hidden: true, value: '', focus() {}, setAttribute() {}, handlers: {}, classList: { add(value) { this.value = value; }, remove() { this.value = ''; } },
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
    async sendMessage(message) { messages.push(message); if (message.type === 'manual-group-pending') return null; if (response instanceof Error) throw response; return response; },
    async openOptionsPage() { opened++; }
  } };
  const run = (preferences = {}) => startPopup(api,doc,view,async () => ({ config: { language: 'zh', ...preferences } }));
  return {elements,pending,view,doc,api,messages,run,get closed() {return closed;},get opened() {return opened;}};
}

test('popup：只执行一次，显示结果 3 秒，淡出后关闭', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.messages,[{type:'manual-group-pending',windowId:7},{type:'toolbar-execute',windowId:7}]);
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


test('popup：待确认项优先展示，可编辑地址，不同步也不自动关闭', async () => {
  const f = fixture();
  const messages = [];
  f.api.runtime.sendMessage = async message => {
    messages.push(message);
    if (message.type === 'manual-group-pending') return { id: 'request', name: '工作', pattern: 'https://example.com/*' };
    return { ok: true };
  };
  await f.run();
  assert.equal(f.elements.ruleForm.hidden, false);
  assert.match(f.elements.question.textContent,/工作/);
  assert.equal(f.elements.pattern.value, 'https://example.com/*');
  assert.equal(f.pending.size,0);
  assert.equal(messages.length,1);
  f.elements.pattern.value = 'staging.example.com';
  await f.elements.ruleForm.handlers.submit({ preventDefault() {} });
  assert.deepEqual(messages.at(-1), { type:'manual-group-add',windowId:7,id:'request',input:'staging.example.com' });
  assert.equal(f.elements.ruleForm.hidden,true);
  assert.equal([...f.pending.values()][0].ms,3000);
  f.elements.settings.handlers.pointerenter();
  assert.equal(f.pending.size,0);
});

test('popup：无效地址保留输入框，取消不执行同步', async () => {
  const f = fixture();
  const messages = [];
  f.api.runtime.sendMessage = async message => {
    messages.push(message);
    if (message.type === 'manual-group-pending') return { id:'request',name:'工作',pattern:'https://example.com/*' };
    return message.type === 'manual-group-add' ? {ok:false,reason:'invalid-pattern'} : {ok:true};
  };
  await f.run();
  f.elements.pattern.value = '';
  await f.elements.ruleForm.handlers.submit({preventDefault(){}});
  assert.equal(f.elements.ruleForm.hidden,false);
  assert.match(f.elements.status.textContent,/有效/);
  await f.elements.cancelPattern.handlers.click({preventDefault(){}});
  assert.equal(f.closed,1);
  assert.equal(messages.some(message => message.type === 'toolbar-execute'),false);
});


test('关闭结果提示：继续执行快捷动作，完成后直接关闭，不设置结果计时',async()=>{
  const f=fixture();
  await f.run({showActionResult:false});
  assert.equal(f.messages.some(message=>message.type==='toolbar-execute'),true);
  assert.equal(f.elements.status.hidden,true);
  assert.equal(f.closed,1);
  assert.equal(f.pending.size,0);
});

test('关闭结果提示不影响手动规则确认表单',async()=>{
  const f=fixture();
  f.api.runtime.sendMessage=async()=>({id:'request',name:'工作',pattern:'https://example.com/*'});
  await f.run({showActionResult:false});
  assert.equal(f.elements.ruleForm.hidden,false);
  assert.equal(f.elements.status.hidden,false);
  assert.equal(f.closed,0);
  assert.equal(f.pending.size,0);
});
