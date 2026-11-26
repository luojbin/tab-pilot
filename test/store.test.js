import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG,
  GROUP_COLORS,
  SCHEMA_VERSION,
  validateConfig,
  buildConfigFromRules,
  normalizeClickAction,
  normalizeLanguage,
  colorForIndex,
  parseConfigText,
  colorOf,
  clone
} from '../src/app/store.js';

function validConfig() {
  return clone(DEFAULT_CONFIG);
}


test('默认配置能通过校验', () => {
  const result = validateConfig(validConfig());
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 2);
});

test('clone 产生独立副本', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.rules[0].tabGroup.minTabs = 99;
  assert.equal(DEFAULT_CONFIG.rules[0].tabGroup.minTabs, 1);
});

test('schemaVersion 不符时拒绝', () => {
  const config = validConfig();
  config.schemaVersion = 99;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('开发期旧格式配置被拒绝（1.0 起不再迁移）', () => {
  const old = {
    schemaVersion: 5,
    rules: [
      {
        id: 'dev-localhost',
        enabled: true,
        priority: 100,
        match: { urlPattern: '^*://localhost:*/*' },
        actions: [{ type: 'group', name: '开发', color: 'green' }]
      }
    ]
  };
  const result = validateConfig(old);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('旧全局开关被忽略并从读取与导入结果中移除', () => {
  for (const value of [false, true, 'old']) {
    const config = { ...validConfig(), globalEnabled: value };
    const result = validateConfig(config);
    assert.equal(result.ok, true);
    assert.equal('globalEnabled' in result.config, false);
    assert.equal('globalEnabled' in parseConfigText(JSON.stringify(config)).config, false);
  }
});

test('rules 不是数组时拒绝', () => {
  const config = validConfig();
  config.rules = {};
  assert.equal(validateConfig(config).ok, false);
});

test('重复 id 被拒绝', () => {
  const config = validConfig();
  config.rules.push(clone(config.rules[0]));
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /重复/);
});

test('分组名必须非空', () => {
  const config = validConfig();
  config.rules[0].name = '   ';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /name/);
});

test('patterns 必须是非空数组', () => {
  for (const patterns of [[], undefined, 'x', ['']]) {
    const config = validConfig();
    if (patterns === undefined) delete config.rules[0].patterns;
    else config.rules[0].patterns = patterns;
    assert.equal(validateConfig(config).ok, false, `${JSON.stringify(patterns)} 应被拒绝`);
  }
  const okConfig = validConfig();
  okConfig.rules[0].patterns = ['*://a/*', '*://b/*'];
  assert.equal(validateConfig(okConfig).ok, true);
});

test('minTabs 必须 >= 1 的整数', () => {
  for (const bad of [0, 1.5, -2, '2', null]) {
    const config = validConfig();
    config.rules[0].tabGroup.minTabs = bad;
    assert.equal(validateConfig(config).ok, false, `minTabs=${JSON.stringify(bad)} 应被拒绝`);
  }
  const okConfig = validConfig();
  okConfig.rules[0].tabGroup.minTabs = 3;
  assert.equal(validateConfig(okConfig).ok, true);
});

test('未知分组颜色被拒绝，预设颜色全部接受', () => {
  const bad = validConfig();
  bad.rules[0].color = 'magenta';
  assert.equal(validateConfig(bad).ok, false);

  for (const color of GROUP_COLORS) {
    const config = validConfig();
    config.rules[0].color = color;
    assert.equal(validateConfig(config).ok, true, `${color} 应被接受`);
  }
});

test('enabled / collapsed 必须是布尔值', () => {
  const config = validConfig();
  config.rules[0].enabled = 'yes';
  config.rules[0].tabGroup.collapsed = 1;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => /enabled|collapsed/.test(error)).length, 2);
});

test('colorOf：非法或缺失颜色回退到 grey', () => {
  assert.equal(colorOf({ color: 'blue' }), 'blue');
  assert.equal(colorOf({ color: 'magenta' }), 'grey');
  assert.equal(colorOf({}), 'grey');
  assert.equal(colorOf(null), 'grey');
});

test('错误信息带字段路径', () => {
  const config = validConfig();
  config.rules[0].patterns = [''];
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^rules\[0\]\.patterns\[0\]/);
});

test('非对象输入被拒绝', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.equal(validateConfig(bad).ok, false);
  }
});

test('parseConfigText：合法 JSON 文本通过', () => {
  const result = parseConfigText(JSON.stringify(validConfig()));
  assert.equal(result.ok, true);
  assert.equal(result.config.rules.length, 1);
});

test('parseConfigText：开发期旧格式会被拒绝', () => {
  const old = { schemaVersion: 4, globalEnabled: true, rules: [] };
  const result = parseConfigText(JSON.stringify(old));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('parseConfigText：JSON 语法错误给出明确提示', () => {
  const result = parseConfigText('{ "rules": [ }');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^JSON 语法错误/);
});

test('parseConfigText：空文本与非字符串被拒绝', () => {
  assert.equal(parseConfigText('   \n ').ok, false);
  assert.equal(parseConfigText(null).ok, false);
  assert.equal(parseConfigText(123).ok, false);
});

test('导出文本可被导入解析（round-trip）', () => {
  const config = validConfig();
  config.rules.push({
    id: 'code-github',
    enabled: true,
    name: '代码',
    color: 'blue',
    tabGroup: { enabled: true, collapsed: false, minTabs: 3, strictMode: false },
    note: '攒够 3 个再归组',
    patterns: ['*://*.github.com/*', '*://gitlab.com/*']
  });

  const text = `${JSON.stringify(config, null, 2)}\n`;
  const parsed = parseConfigText(text);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.config, config);
});

test('导入开发期旧版本文件会被拒绝', () => {
  const old = {
    schemaVersion: 5,
    rules: [
      { id: 'dev', enabled: true, name: '开发', color: 'green', patterns: ['*://localhost:*/*'] }
    ]
  };
  const result = parseConfigText(JSON.stringify(old, null, 2));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('highlight：非法结构与越界数值被拒绝', () => {
  const config = validConfig();
  config.rules[0].highlight = {
    enabled: 'yes',
    border: { sides: 'top', width: 99 },
    banner: { positions: [1], size: 999, fontSize: 2 }
  };

  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const joined = result.errors.join('\n');
  assert.match(joined, /highlight\.enabled/);
  assert.match(joined, /highlight\.border\.sides/);
  assert.match(joined, /highlight\.border\.width/);
  assert.match(joined, /highlight\.banner\.positions/);
  assert.match(joined, /highlight\.banner\.size/);
  assert.match(joined, /highlight\.banner\.fontSize/);
});

test('highlight：合法配置通过校验', () => {
  const config = validConfig();
  config.rules[0].highlight = {
    enabled: true,
    border: { sides: ['top', 'left'], width: 8 },
    banner: { positions: ['topLeft', 'bottomRight'], size: 36, fontSize: 15 }
  };
  assert.equal(validateConfig(config).ok, true);
});

test('buildConfigFromRules：保留 highlight / titleRule 并规范化字段（回归）', () => {
  const config = buildConfigFromRules( [
    {
      id: 'dev',
      name: '  开发  ',
      color: 'green',
      minTabs: undefined,
      note: '  本地  ',
      patterns: [' *://localhost:*/* ', ''],
      highlight: {
        enabled: true,
        border: { sides: ['top'], width: 6 },
        banner: { positions: ['topRight'], size: 30, fontSize: 15 }
      },
      titleRule: {
        enabled: true,
        rules: [
          { titlePattern: '^(.*)$', replacement: '[T] X ${title.1}', description: '测试' }
        ],
        testCases: [{ title: 'a', url: '' }, { title: 'b', url: '' }]
      }
    }
  ]);

  assert.equal(config.schemaVersion, SCHEMA_VERSION);
  assert.equal(config.rules[0].name, '开发');
  assert.equal(config.rules[0].note, '本地');
  assert.equal(config.rules[0].tabGroup.minTabs, 1);
  assert.deepEqual(config.rules[0].patterns, ['*://localhost:*/*']);
  assert.equal(config.rules[0].highlight.enabled, true, 'highlight 不能在组装时丢失');
  assert.equal(config.rules[0].titleRule.enabled, true, 'titleRule 不能在组装时丢失');
  assert.equal(config.rules[0].titleRule.rules[0].titlePattern, '^(.*)$');
  assert.equal(config.rules[0].titleRule.rules[0].replacement, '[T] X ${title.1}');
  assert.deepEqual(config.rules[0].titleRule.testCases, [{ title: 'a', url: '' }, { title: 'b', url: '' }]);
  assert.equal(validateConfig(config).ok, true);
});

test('buildConfigFromRules：没有 highlight 时不凭空补字段', () => {
  const config = buildConfigFromRules( [
    { id: 'x', name: 'X', patterns: ['*://x/*'] }
  ]);
  assert.equal('highlight' in config.rules[0], false);
  assert.equal('titleRule' in config.rules[0], false);
  assert.equal(validateConfig(config).ok, true);
});

test('默认配置带 titleRule：默认关闭、规则组为空', () => {
  const titleRule = DEFAULT_CONFIG.rules[0].titleRule;
  assert.equal(titleRule.enabled, false);
  assert.deepEqual(titleRule.rules, []);
  assert.deepEqual(titleRule.testCases, []);
});

test('titleRule：规则里的非法正则被拒绝', () => {
  const bad = validConfig();
  bad.rules[0].titleRule = {
    enabled: true,
    rules: [{ titlePattern: '([', replacement: 'x' }],
    testCases: []
  };
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /规则组“开发”的第 1 条命名规则：标题条件不是合法的正则/);
});

test('titleRule：空 pattern 被拒绝', () => {
  const bad = validConfig();
  bad.rules[0].titleRule = { enabled: true, rules: [{ titlePattern: '   ' }], testCases: [] };
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /标题条件和 URL 条件至少填写一个正则/);
});

test('highlight：边框与 banner 的不透明度各自校验 0~100', () => {
  const bad = validConfig();
  bad.rules[0].highlight = {
    enabled: true,
    border: { opacity: 150 },
    banner: { opacity: -5 }
  };
  const badResult = validateConfig(bad);
  assert.equal(badResult.ok, false);
  const joined = badResult.errors.join('\n');
  assert.match(joined, /highlight\.border\.opacity/);
  assert.match(joined, /highlight\.banner\.opacity/);

  const good = validConfig();
  good.rules[0].highlight = {
    enabled: true,
    border: { opacity: 100 },
    banner: { opacity: 35 }
  };
  assert.equal(validateConfig(good).ok, true);
});

test('colorForIndex：按序号循环取色，9 个颜色一轮', () => {
  assert.equal(colorForIndex(0), GROUP_COLORS[0]);
  assert.equal(colorForIndex(1), GROUP_COLORS[1]);
  assert.equal(colorForIndex(9), GROUP_COLORS[0]);
  assert.equal(colorForIndex(10), GROUP_COLORS[1]);
  assert.equal(colorForIndex(-1), GROUP_COLORS[1]);
  assert.equal(colorForIndex('2'), GROUP_COLORS[2]);
  assert.equal(colorForIndex('x'), GROUP_COLORS[0]);
});

test('clickAction：同步、重命名及动作菜单取值均可通过校验，未知值被拒绝', () => {
  for (const action of ['sync', 'syncRuleCollapse', 'syncCollapseInactive', 'syncCollapseAll', 'renameTab', 'actionMenu']) {
    const config = validConfig();
    config.clickAction = action;
    assert.equal(validateConfig(config).ok, true, `${action} 应被接受`);
  }

  const bad = validConfig();
  bad.clickAction = 'collapseEverything';
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /clickAction/);
});

test('clickAction：缺省或未知值回退到 sync，构建配置会补上默认值', () => {
  const legacy = validConfig();
  delete legacy.clickAction;
  assert.equal(validateConfig(legacy).ok, true, '旧配置没有该字段也能读取');

  assert.equal(normalizeClickAction(undefined), 'sync');
  assert.equal(normalizeClickAction('collapseEverything'), 'sync');
  assert.equal(normalizeClickAction('syncCollapseAll'), 'syncCollapseAll');

  const built = buildConfigFromRules(
    [{ id: 'a', name: 'A', patterns: ['*://a/*'] }],
    'syncCollapseAll'
  );
  assert.equal(built.clickAction, 'syncCollapseAll');
  assert.equal(buildConfigFromRules( []).clickAction, 'sync');
});

test('language：auto / zh / en 通过校验，未知值被拒绝', () => {
  for (const language of ['auto', 'zh', 'en']) {
    const config = validConfig();
    config.language = language;
    assert.equal(validateConfig(config).ok, true, `${language} 应被接受`);
  }

  const bad = validConfig();
  bad.language = 'fr';
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /language/);
});

test('language：缺省或未知值回退到 auto，构建配置会写入默认值', () => {
  const legacy = validConfig();
  delete legacy.language;
  assert.equal(validateConfig(legacy).ok, true, '旧配置没有该字段也能读取');

  assert.equal(normalizeLanguage(undefined), 'auto');
  assert.equal(normalizeLanguage('fr'), 'auto');
  assert.equal(normalizeLanguage('en'), 'en');

  const built = buildConfigFromRules( [], 'sync', 'en');
  assert.equal(built.language, 'en');
  assert.equal(buildConfigFromRules( []).language, 'auto');
});

test('groupsFirst：缺省关闭，校验布尔值并保留配置往返', () => {
  const config = validConfig();
  delete config.groupsFirst;
  assert.equal(validateConfig(config).ok, true);
  assert.equal(buildConfigFromRules( []).groupsFirst, false);
  config.groupsFirst = 'true';
  assert.equal(validateConfig(config).ok, false);
  config.groupsFirst = true;
  assert.equal(parseConfigText(JSON.stringify(config)).config.groupsFirst, true);
  assert.equal(buildConfigFromRules( [], 'sync', 'auto', true).groupsFirst, true);
});

test('全局提示开关：默认开启、兼容缺省、校验类型并保留导入导出', () => {
  assert.equal(DEFAULT_CONFIG.autoUpdateGroupRules,true);
  assert.equal(DEFAULT_CONFIG.showActionResult,true);
  const defaults = buildConfigFromRules( []);
  assert.equal(defaults.autoUpdateGroupRules,true);
  assert.equal(defaults.showActionResult,true);
  const old = validConfig();
  delete old.autoUpdateGroupRules;
  delete old.showActionResult;
  assert.equal(validateConfig(old).ok,true);
  for (const key of ['autoUpdateGroupRules','showActionResult']) {
    const invalid = validConfig();
    invalid[key] = 'false';
    const checked = validateConfig(invalid);
    assert.equal(checked.ok,false);
    assert.ok(checked.errors.some(error => error.includes(key)));
  }
  const config = buildConfigFromRules( [], 'sync', 'zh', true, { autoUpdateGroupRules:false, showActionResult:false });
  const roundtrip = parseConfigText(JSON.stringify(config));
  assert.equal(roundtrip.ok,true);
  assert.equal(roundtrip.config.autoUpdateGroupRules,false);
  assert.equal(roundtrip.config.showActionResult,false);
  assert.equal(roundtrip.config.groupsFirst,true);
});

test('规则 strictMode：默认关闭、兼容缺省，配置构建及导入导出保留开关', () => {
  assert.equal('strictMode' in DEFAULT_CONFIG,false);
  assert.equal(DEFAULT_CONFIG.rules[0].tabGroup.strictMode,false);
  const old=validConfig();delete old.rules[0].tabGroup.strictMode;
  assert.equal(validateConfig(old).ok,true);
  const config=buildConfigFromRules([{id:'a',name:'A',patterns:['https://a/*'],tabGroup:{strictMode:true}},{id:'b',name:'B',patterns:['https://b/*']}]);
  assert.equal('strictMode' in config,false);
  const parsed=parseConfigText(JSON.stringify(config));
  assert.equal(parsed.config.rules[0].tabGroup.strictMode,true);
  assert.equal(parsed.config.rules[1].tabGroup.strictMode,false);
  config.rules[0].tabGroup.strictMode='true';
  assert.equal(validateConfig(config).ok,false);
});

test('追加导入：只校验规则与 schemaVersion，完全忽略文件全局设置',()=>{
  const config={...validConfig(),language:'invalid',clickAction:'bad',strictMode:'bad',showActionResult:'bad',autoUpdateGroupRules:'bad',groupsFirst:'bad'};
  assert.equal(parseConfigText(JSON.stringify(config)).ok,false);
  const parsed=parseConfigText(JSON.stringify(config),{rulesOnly:true});
  assert.equal(parsed.ok,true);
  assert.deepEqual(Object.keys(parsed.config).sort(),['rules','schemaVersion']);
  assert.deepEqual(parsed.config.rules,config.rules);
});

test('追加导入：非法格式和规则拒绝，同名留待追加时重命名',()=>{
  for(const text of ['', '{', 'null', JSON.stringify({schemaVersion:99,rules:[]}),JSON.stringify({schemaVersion:1,rules:[{id:'bad',name:'bad',patterns:[]}]})]){
    assert.equal(parseConfigText(text,{rulesOnly:true}).ok,false);
  }
  const config=validConfig();
  config.rules.push({...structuredClone(config.rules[0]),id:'another-id'});
  assert.equal(parseConfigText(JSON.stringify(config)).ok,false);
  assert.equal(parseConfigText(JSON.stringify(config),{rulesOnly:true}).ok,true);
});

test('旧全局 strictMode 迁移：只补齐缺省规则，组内显式值优先，不修改原对象',()=>{
  const raw={...validConfig(),schemaVersion:1,strictMode:true,rules:[
    {id:'a',name:'A',patterns:['https://a/*']},
    {id:'b',name:'B',patterns:['https://b/*'],strictMode:false},
    {id:'c',name:'C',patterns:['https://c/*'],strictMode:true}
  ]};
  const before=structuredClone(raw);
  const result=validateConfig(raw);
  assert.equal(result.ok,true);
  assert.equal('strictMode' in result.config,false);
  assert.deepEqual(result.config.rules.map(rule=>rule.tabGroup.strictMode),[true,false,true]);
  assert.deepEqual(raw,before);
  assert.deepEqual(parseConfigText(JSON.stringify(result.config)).config,result.config);
  raw.strictMode=false;
  assert.deepEqual(validateConfig(raw).config.rules.map(rule=>rule.tabGroup.strictMode),[false,false,true]);
});

test('追加导入：保留组内 strictMode，忽略旧全局 strictMode，不污染现有规则',()=>{
  const raw={schemaVersion:1,strictMode:true,rules:[
    {id:'a',name:'A',patterns:['https://a/*']},
    {id:'b',name:'B',patterns:['https://b/*'],strictMode:true}
  ]};
  const result=parseConfigText(JSON.stringify(raw),{rulesOnly:true});
  assert.equal(result.ok,true);
  assert.equal('strictMode' in result.config,false);
  assert.equal(result.config.rules[0].tabGroup.strictMode,false);
  assert.equal(result.config.rules[1].tabGroup.strictMode,true);
});

test('schema 1：读取和两种导入均迁移标题规则与测试用例，保持模板效果且不修改输入', () => {
  const old = validConfig();
  old.schemaVersion = 1;
  old.rules[0].titleRule = { enabled: true,
    rules: [{ pattern: '^(.*)$', replacement: '$1 ${url.1} $$', description: 'legacy' }],
    testText: ' Alpha \r\n\nBeta' };
  const snapshot = JSON.stringify(old);
  for (const result of [validateConfig(old), parseConfigText(snapshot), parseConfigText(snapshot, { rulesOnly: true })]) {
    assert.equal(result.ok, true, result.errors?.join('\n'));
    assert.equal(result.config.schemaVersion, 2);
    const spec = result.config.rules[0].titleRule;
    assert.deepEqual(spec.rules[0], { titlePattern: '^(.*)$', urlPattern: '', replacement: '${title.1} $${url.1} $$', description: 'legacy' });
    assert.deepEqual(spec.testCases, [{ title: 'Alpha', url: '' }, { title: 'Beta', url: '' }]);
    assert.equal('testText' in spec, false);
    assert.equal(validateConfig(result.config).ok, true);
  }
  assert.equal(JSON.stringify(old), snapshot);
});

test('schema 2：URL-only 与双条件有效，旧字段、非法 URL 正则与非结构化测试被拒绝', () => {
  for (const entry of [{ urlPattern: '/(42)$', replacement: '${url.1}' },
    { titlePattern: '^App$', urlPattern: '/(42)$', replacement: '${title.0} ${url.1}' }]) {
    const config = validConfig();
    config.rules[0].titleRule = { enabled: true, rules: [entry], testCases: [{ title: 'App', url: 'https://host/42' }] };
    assert.equal(validateConfig(config).ok, true);
  }
  for (const spec of [
    { rules: [{ pattern: '^App$', replacement: 'x' }] },
    { rules: [{ titlePattern: '^App$', urlPattern: '[' }] },
    { rules: [{ urlPattern: 42 }] },
    { testText: 'App' }, { testCases: 'App' }, { testCases: ['App'] },
    { testCases: [{ title: 'App' }] }, { testCases: [{ title: 42, url: '' }] }
  ]) {
    const config = validConfig();
    config.rules[0].titleRule = spec;
    assert.equal(validateConfig(config).ok, false, JSON.stringify(spec));
  }
});

test('schema 1：坏标题规则不会在迁移时被静默吞掉', () => {
  for (const spec of [{ testText: 42 }, { rules: [{ pattern: '[' }] }, { rules: [{ pattern: 42 }] }]) {
    const config = validConfig();
    config.schemaVersion = 1;
    config.rules[0].titleRule = spec;
    assert.equal(validateConfig(config).ok, false);
  }
});

test('schema 1 → 2：群组旧字段迁移，三种读取路径一致，不修改原输入', () => {
  const raw = { schemaVersion: 1, rules: [{ id: 'a', name: 'A', patterns: ['https://a/*'],
    minTabs: 4, collapsed: true, strictMode: true }] };
  const before = JSON.stringify(raw);
  for (const result of [validateConfig(raw), parseConfigText(before), parseConfigText(before, { rulesOnly: true })]) {
    assert.equal(result.ok, true, result.errors?.join('\n'));
    assert.equal(result.config.schemaVersion, 2);
    assert.deepEqual(result.config.rules[0].tabGroup, { enabled: true, minTabs: 4, collapsed: true, strictMode: true });
    for (const field of ['minTabs', 'collapsed', 'strictMode']) assert.equal(field in result.config.rules[0], false);
  }
  assert.equal(JSON.stringify(raw), before);
});

test('schema 2：tabGroup 缺省合法，完整构建与禁用状态导入导出保留，字段类型严格校验', () => {
  const config = buildConfigFromRules([{ id: 'a', name: 'A', patterns: ['https://a/*'], tabGroup: { enabled: false, minTabs: 3, collapsed: true, strictMode: true } }]);
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(parseConfigText(JSON.stringify(config)).config, config);
  const minimal = { schemaVersion: 2, rules: [{ id: 'a', name: 'A', patterns: ['https://a/*'] }] };
  assert.equal(validateConfig(minimal).ok, true);
  for (const tabGroup of [null, [], false, { enabled: 'false' }, { minTabs: 0 }, { minTabs: 1.5 }, { minTabs: '2' }, { collapsed: 1 }, { strictMode: null }]) {
    const raw = structuredClone(minimal);
    raw.rules[0].tabGroup = tabGroup;
    assert.equal(validateConfig(raw).ok, false, JSON.stringify(tabGroup));
  }
  for (const field of ['minTabs', 'collapsed', 'strictMode']) {
    const raw = structuredClone(minimal);
    raw.rules[0][field] = field === 'minTabs' ? 2 : true;
    assert.equal(validateConfig(raw).ok, false);
  }
});

test('schema 1 迁移不会丢弃旧群组字段的非法值', () => {
  for (const fields of [{ minTabs: null }, { collapsed: 'true' }, { strictMode: 'false' }]) {
    assert.equal(validateConfig({ schemaVersion: 1, rules: [{ id: 'a', name: 'A', patterns: ['https://a/*'], ...fields }] }).ok, false);
  }
});

test('当前 schema 2 不执行中间格式迁移，开发期 schema 3 和平铺群组字段被拒绝', async () => {
  const { migrateConfig } = await import('../src/core/config-migration.js');
  const config = validConfig();
  assert.equal(config.schemaVersion, 2);
  assert.equal(migrateConfig(config), config);
  const old = { schemaVersion: 2, rules: [{ id: 'a', name: 'A', patterns: ['https://a/*'], minTabs: 3, collapsed: true }] };
  assert.equal(validateConfig(old).ok, false);
  const development = { ...config, schemaVersion: 3 };
  assert.equal(migrateConfig(development), development);
  assert.equal(validateConfig(development).ok, false);
});

test('命名规则校验：显示规则组名和条目序号，结构化索引和字段路径不混淆', () => {
  const config = { schemaVersion: 2, rules: Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, name: `G${i}`, patterns: ['https://host/*'] })) };
  config.rules[2].titleRule = { enabled: true, rules: [{ titlePattern: '[' }, { urlPattern: 42, replacement: 7 }] };
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^规则组“G2”的第 1 条命名规则：标题条件不是合法的正则：/);
  assert.ok(result.errors.some(message => message.includes('第 2 条命名规则：URL 条件必须是字符串')));
  assert.deepEqual(result.errorDetails.map(error => error.ruleIndex), result.errors.map(() => 2));
  assert.equal(result.errorDetails[0].entryIndex, 0);
  assert.equal(result.errorDetails[0].path, 'rules[2].titleRule.rules[0].titlePattern');
  assert.ok(result.errorDetails.some(error => error.entryIndex === 1 && error.path.endsWith('.replacement')));
  config.rules[2].name = '';
  assert.ok(validateConfig(config).errors.some(message => message.startsWith('第 3 个规则组的第 1 条命名规则：')));
});

test('普通字段和重名校验：包含结构化位置，原有字符串错误仍可用', () => {
  const result = validateConfig({ schemaVersion: 2, rules: [
    { id: 'a', name: 'A', patterns: ['https://a/*'] },
    { id: 'b', name: 'A', patterns: ['https://b/*'], tabGroup: { minTabs: 0 }, highlight: { border: { width: 0 }, banner: { fontSize: 99 } } }
  ] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.every(message => typeof message === 'string'));
  assert.equal(result.errorDetails.length, result.errors.length);
  assert.ok(result.errorDetails.every(error => error.ruleIndex === 1));
  assert.deepEqual(result.errorDetails.find(error => error.message.includes('name 重复')).relatedRuleIndexes, [0]);
});

test('schema 1 标题迁移严格采用旧 pattern 并清空 URL，统一数字/命名/完整匹配引用', async () => {
  const { applyTitleRules } = await import('../src/core/title-rule.js');
  for (const [pattern, replacement, expectedTemplate, expectedTitle] of [
    ['(App)', '$1', '${title.1}', 'App'],
    ['(?<app>App)', '$<app>', '${title.app}', 'App'],
    ['App', '$&', '${title.0}', 'App'],
    ['App', "X$`$'", 'X', 'X']
  ]) {
    const raw = { schemaVersion: 1, rules: [{ id: 'a', name: 'A', patterns: ['https://host/*'], titleRule: { enabled: true,
      rules: [{ pattern, titlePattern: 'Other', urlPattern: 'https://other/*', replacement }] } }] };
    const before = JSON.stringify(raw);
    for (const result of [validateConfig(raw), parseConfigText(before), parseConfigText(before, { rulesOnly: true })]) {
      assert.equal(result.ok, true, result.errors?.join('\n'));
      const rule = result.config.rules[0];
      const migrated = rule.titleRule.rules[0];
      assert.equal('pattern' in migrated, false);
      assert.equal(migrated.titlePattern, pattern);
      assert.equal(migrated.urlPattern, '');
      assert.equal(migrated.replacement, expectedTemplate);
      assert.equal(applyTitleRules(rule, 'App', 'https://host/42').result, expectedTitle);
      assert.equal(applyTitleRules(rule, 'prefix App suffix', 'https://host/42').matched, false);
    }
    assert.equal(JSON.stringify(raw), before);
  }
});

test('schema 1 迁移：真正空条件和非空非法表达式或类型仍拒绝，不静默删条目', () => {
  for (const entry of [{}, { pattern: '' }, { pattern: '', titlePattern: '', urlPattern: ' ' },
    { pattern: '[', titlePattern: 'App' }, { pattern: 42, titlePattern: 'App' }, { titlePattern: 'App', urlPattern: 'https://host/*' },
    { pattern: '', titlePattern: 'App' }, { pattern: null, titlePattern: 'App' }, { titlePattern: 'App', urlPattern: 42 }]) {
    const result = validateConfig({ schemaVersion: 1, rules: [{ id: 'a', name: 'A', patterns: ['https://host/*'], titleRule: { rules: [entry] } }] });
    assert.equal(result.ok, false, JSON.stringify(entry));
    assert.ok(result.errorDetails.every(error => error.ruleIndex === 0));
  }
});
