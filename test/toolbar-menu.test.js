import test from 'node:test';
import assert from 'node:assert/strict';
import { registerToolbarMenu } from '../src/app/toolbar-menu.js';

test('Firefox 图标选项：安装时创建，点击仅打开设置', async () => {
  const installed = [];
  const clicked = [];
  const items = new Map();
  let opened = 0;
  const api = {
    i18n: { getMessage(key) { assert.equal(key,'optionsMenu'); return '选项'; } },
    menus: {
      async remove(id) { if (!items.delete(id)) throw new Error('missing'); },
      create(item, callback) { assert.equal(items.has(item.id),false); items.set(item.id,item); callback(); },
      onClicked: { addListener(fn) { clicked.push(fn); } }
    },
    runtime: {
      onInstalled: { addListener(fn) { installed.push(fn); } },
      async openOptionsPage() { opened++; }
    }
  };
  registerToolbarMenu(api);
  assert.equal(items.size,0);
  await installed[0]();
  await installed[0]();
  assert.equal(items.size,1);
  assert.deepEqual(items.get('tabpilot-options'),{id:'tabpilot-options',title:'选项',contexts:['action']});
  await clicked[0]({menuItemId:'other'});
  assert.equal(opened,0);
  await clicked[0]({menuItemId:'tabpilot-options'});
  assert.equal(opened,1);
});

test('Chromium 没有 menus 时不注册自定义菜单', () => {
  registerToolbarMenu({});
});
