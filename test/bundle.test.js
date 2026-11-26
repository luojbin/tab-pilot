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
      console, setInterval() { return 1; },
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

for (const [namespace, target] of [['browser', 'firefox140'], ['chrome', 'chrome116']]) {
  test(`SPA 路由打包回归：${namespace} 的未命中/纯高亮、主动通知、兜底和乱序响应`, async () => {
    const { outputFiles } = await build({
      absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), entryPoints: ['src/app/content.js'],
      bundle: true, format: 'iife', platform: 'browser', target, write: false
    });
    const script = new vm.Script(outputFiles[0].text);
    const element = () => ({ style: {}, children: [], setAttribute() {},
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
    });
    const location = { href: 'https://host/off' };
    const document = { title: 'App', head: {}, body: element(), documentElement: element(), createElement: element };
    const styles = {
      a: { ruleId: 'a', name: 'A', colorHex: 'red', titleRule: { enabled: false } },
      b: { ruleId: 'b', name: 'B', colorHex: 'blue', titleRule: { enabled: true,
        rules: [{ titlePattern: 'App', urlPattern: 'https://host/(?<code>[^/?#]+).*', replacement: '${url.code}' }] } },
      c: { ruleId: 'c', name: 'C', colorHex: 'green', titleRule: { enabled: false } },
      d: { ruleId: 'd', name: 'D', colorHex: 'purple', titleRule: { enabled: true,
        rules: [{ titlePattern: 'App', replacement: 'D' }] } }
    };
    for (const style of Object.values(styles)) style.highlight = {
      enabled: true, border: { sides: ['top'], width: 4, opacity: 100 }, banner: { positions: [] }
    };
    const queries = [], events = {}, intervals = [];
    let message, observer, highlightMutation;
    const lookup = ({ url }) => styles[new URL(url).pathname.slice(1)] || null;
    let responder = lookup;
    const context = vm.createContext({
      [namespace]: { runtime: { onMessage: { addListener(fn) { message = fn; } },
        async sendMessage(value) { queries.push(value); return responder(value); } } },
      document, location, URL, console: { info() {}, warn() {} },
      window: { addEventListener(type, fn) { events[type] = fn; } },
      MutationObserver: class {
        constructor(fn) { this.callback = fn; }
        observe(target) {
          if (target === document.head) observer = this.callback;
          else highlightMutation = this.callback;
        }
        disconnect() {}
      },
      setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}
    });
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const notify = () => message({ type: 'tabpilot:refresh', reason: 'navigation' });
    const color = () => document.body.children[0]?.children[0]?.style.background;
    script.runInContext(context);
    await tick();
    assert.equal(document.body.children.length, 0);
    assert.equal(intervals.length, 1, '未命中时也保留 URL 兜底');
    location.href = 'https://host/a';
    intervals[0]();
    await tick();
    assert.equal(color(), 'red', '从未命中进入只开高亮的规则');
    const originalRoot = document.body.children[0];
    message({ type: 'tabpilot:refresh' }); await tick();
    assert.equal(document.body.children[0], originalRoot, '相同样式强制刷新不重建标识');
    const beforeRemoval = queries.length;
    document.body.removeChild(originalRoot);
    originalRoot.isConnected = false;
    highlightMutation();
    assert.equal(color(), 'red', 'DOM 监听即时恢复被移除的标识');
    assert.equal(queries.length, beforeRemoval, '同 URL 恢复复用样式，不请求后台');
    const oldBodyRoot = document.body.children[0];
    oldBodyRoot.isConnected = false;
    document.body = element();
    highlightMutation();
    assert.equal(color(), 'red', '替换整个 body 后恢复标识');
    const restoredRoot = document.body.children[0];
    highlightMutation();
    assert.equal(document.body.children[0], restoredRoot, '自身 DOM 变更不会导致循环重建');
    const removedRoot = document.body.children[0];
    document.body.removeChild(removedRoot);
    removedRoot.isConnected = false;
    intervals[0](); await tick();
    assert.equal(color(), 'red', '页面移除标识后，同 URL 也能重建');
    styles.a.colorHex = 'orange';
    events.pageshow({ persisted: true }); await tick();
    assert.equal(color(), 'orange', '往返缓存恢复时重新读取配置');
    assert.notEqual(document.body.children[0], restoredRoot, '颜色变化仍会重建标识');
    location.href = 'https://host/b';
    const before = queries.length;
    notify();
    assert.equal(queries.length, before + 1, '主动通知不等待轮询');
    await tick();
    assert.equal(document.title, 'b');
    let titleContext;
    message({ type: 'tabpilot:title-context' }, {}, value => { titleContext = value; });
    assert.equal(titleContext.title, 'App', '快捷入口可读取改写前的原标题');
    assert.equal(titleContext.url, location.href);
    assert.equal(document.title, 'b', '读取原标题不会改变页面标题');
    assert.equal(color(), 'blue');
    location.href = 'https://host/c'; notify(); await tick();
    assert.equal(document.title, 'App');
    assert.equal(color(), 'green');
    location.href = 'https://host/off'; intervals[0](); await tick();
    assert.equal(document.body.children.length, 0);
    highlightMutation();
    assert.equal(document.body.children.length, 0, '退出规则后不恢复旧标识');
    location.href = 'https://host/b';
    const initial = queries.length;
    events.popstate(); events.hashchange(); notify(); intervals[0]();
    assert.equal(queries.length, initial + 1, '重复来源合并同一 URL 的在途请求');
    await tick();
    assert.equal(document.title, 'b', '停止重命名后仍能重新进入重命名规则');
    let resolveRoute;
    responder = () => new Promise(resolve => { resolveRoute = resolve; });
    location.href = 'https://host/d'; document.title = 'App';
    observer();
    assert.equal(document.title, 'App', 'URL 已变时不允许旧规则先改写标题');
    const pending = queries.length;
    observer(); intervals[0](); notify();
    assert.equal(queries.length, pending);
    resolveRoute(styles.d); await tick();
    assert.equal(document.title, 'D');
    let resolveOld;
    responder = () => new Promise(resolve => { resolveOld = resolve; });
    location.href = 'https://host/a'; notify();
    responder = lookup;
    location.href = 'https://host/c'; notify(); await tick();
    resolveOld(styles.a); await tick();
    assert.equal(color(), 'green', '快速切换后忽略旧响应');
    assert.equal(document.title, 'App');
    location.href = 'https://host/b'; notify(); await tick();
    responder = () => { throw new Error('temporary message failure'); };
    message({ type: 'tabpilot:refresh' }); await tick();
    assert.equal(document.title, 'App');
    responder = lookup;
    intervals[0](); await tick();
    assert.equal(document.title, 'b', '同 URL 强制刷新失败后也能由兜底恢复');
    assert.equal(intervals.length, 1, '多次路由和功能切换不会重复启动定时器');
  });
}
