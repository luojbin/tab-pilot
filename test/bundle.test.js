import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 验证真实打包结果能作为普通脚本独立运行，不依赖其他脚本或全局模块。
for (const [namespace, target] of [['browser', 'firefox140'], ['chrome', 'chrome116']]) {
  test(`打包入口：${namespace} 环境下后台归组并响应内容脚本查询`, async () => {
    const { outputFiles } = await build({
      absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
      entryPoints: ['src/app/background.js', 'src/app/content.js', 'src/ui/options.js', 'src/ui/popup.js'],
      outdir: 'unused',
      outbase: 'src',
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target,
      write: false
    });
    const scripts = new Map(outputFiles.map(file => [
      file.path.replaceAll('\\', '/').split('/').at(-1),
      new vm.Script(file.text, { filename: file.path })
    ]));
    assert.equal(scripts.size, 4);

    const tab = { id: 1, windowId: 1, groupId: -1, url: 'http://localhost:3000/' };
    const groupCalls = [];
    const listeners = {};
    const event = name => ({ addListener(fn) { listeners[name] = fn; } });
    const api = {
      storage: { local: { async get() { return {}; } }, onChanged: event('storage') },
      tabs: {
        async query() { return [tab]; },
        async group(options) { groupCalls.push(options); return 42; },
        onCreated: event('created'),
        onUpdated: event('updated')
      },
      tabGroups: { async query() { return []; }, async update() {} },
      runtime: {
        onInstalled: event('installed'),
        onStartup: event('startup'),
        onMessage: event('backgroundMessage')
      },
      action: { onClicked: event('clicked') }
    };
    const background = vm.createContext({ [namespace]: api, console, setTimeout, clearTimeout });
    scripts.get('background.js').runInContext(background);
    const stats = await background.TabPilotDebug.syncAll();
    assert.equal(stats.grouped, 1);
    assert.deepEqual(Array.from(groupCalls[0].tabIds), [tab.id]);

    const marks = [];
    const queries = [];
    const content = vm.createContext({
      [namespace]: {
        runtime: {
          onMessage: event('contentMessage'),
          sendMessage(message) {
            queries.push(message);
            return new Promise(resolve => {
              assert.equal(listeners.backgroundMessage(message, { tab }, resolve), true);
            });
          }
        }
      },
      console,
      location: { href: tab.url },
      document: { documentElement: { setAttribute(name, value) { marks.push(value); } } },
      window: { addEventListener() {} }
    });
    scripts.get('content.js').runInContext(content);
    // 默认规则未启用标识/标题，真实后台应回复 null，内容脚本完成初始化并标记 off。
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries[0].type, 'page-style');
    assert.deepEqual(marks, ['loaded', 'off']);
    assert.equal(typeof listeners.contentMessage, 'function');
    assert.equal(background.TabPilotRules, undefined);
    assert.equal(content.TabPilotHighlight, undefined);
  });
}

for (const [namespace, target] of [['browser', 'firefox140'], ['chrome', 'chrome116']]) {
  test(`标题双来源打包回归：${namespace} 的固定标题、SPA URL 变化、恢复及过期响应`, async () => {
    const { outputFiles } = await build({
      absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
      entryPoints: ['src/app/content.js'], bundle: true, format: 'iife', platform: 'browser', target, write: false
    });
    const script = new vm.Script(outputFiles[0].text);
    const location = { href: 'https://host/work/42' };
    const document = { title: 'App', head: {}, documentElement: { setAttribute() {} } };
    const style = { titleRule: { enabled: true, rules: [
      { titlePattern: 'App', urlPattern: 'https://host/work/([0-9]+).*$', replacement: '${title.0} #${url.1}' }
    ], testCases: [] } };
    let observer, watchdog, messageListener;
    let responder = async () => style;
    const context = vm.createContext({
      [namespace]: { runtime: {
        onMessage: { addListener(fn) { messageListener = fn; } },
        sendMessage(message) { return responder(message); }
      } },
      document, location, console: { info() {}, warn() {} },
      window: { addEventListener() {} },
      MutationObserver: class {
        constructor(fn) { observer = fn; }
        observe() {} disconnect() {}
      },
      setInterval(fn) { watchdog = fn; return 1; }, clearInterval() {}
    });
    const tick = () => new Promise(resolve => setImmediate(resolve));
    script.runInContext(context);
    await tick();
    assert.equal(document.title, 'App #42');
    observer();
    assert.equal(document.title, 'App #42', '扩展自己写入标题不会再次套用');
    document.title = 'App';
    observer();
    assert.equal(document.title, 'App #42', '网站反复写回同一个原标题时仍须重新改写');
    location.href = 'https://host/work/43?view=detail#info';
    watchdog();
    await tick();
    assert.equal(document.title, 'App #43', '标题不变的路由切换从原标题与新 URL 重新计算');
    location.href = 'https://host/other';
    watchdog();
    await tick();
    assert.equal(document.title, 'App', 'URL 不再命中时恢复原标题');
    location.href = 'https://host/work/44';
    watchdog();
    await tick();
    assert.equal(document.title, 'App #44');
    document.title = 'prefix App suffix';
    observer();
    assert.equal(document.title, 'prefix App suffix', '标题仅局部包含条件时不命中');
    document.title = 'Page';
    observer();
    assert.equal(document.title, 'Page', '网站设置新标题时不会复用过期原标题');
    document.title = 'App';
    observer();
    assert.equal(document.title, 'App #44');
    let resolveOld;
    responder = () => new Promise(resolve => { resolveOld = resolve; });
    messageListener({ type: 'tabpilot:refresh' });
    responder = async () => null;
    messageListener({ type: 'tabpilot:refresh' });
    await tick();
    assert.equal(document.title, 'App');
    resolveOld(style);
    await tick();
    assert.equal(document.title, 'App', '过期后台响应不能重新启用已关闭规则');
  });
}
