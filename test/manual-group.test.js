import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualGroupController } from '../src/app/manual-group.js';
import { websitePattern, expandWebsiteInput, markAutomaticGrouping, clearAutomaticGrouping } from '../src/core/manual-group-rule.js';

function fixture() {
  let config = {schemaVersion:1,rules:[{id:'work',name:'工作',patterns:['https://old.example/*'],enabled:true}]};
  const data = {};
  const tabs = [{id:10,windowId:1,groupId:3,url:'https://new.example:8443/path?q=secret#hash'}];
  const groups = [{id:3,windowId:1,title:'工作',color:'blue'}];
  const badges = [];
  let opens = 0;
  let saves = 0;
  let syncs = 0;
  let failOpen = false;
  const api = {
    storage:{local:{async get(key){return {[key]:structuredClone(data[key])};},async set(values){Object.assign(data,structuredClone(values));}}},
    tabs:{async query(){return structuredClone(tabs);},async get(id){const tab=tabs.find(t=>t.id===id);if(!tab)throw Error();return {...tab};}},
    tabGroups:{async get(id){const group=groups.find(g=>g.id===id);if(!group)throw Error();return {...group};}},
    action:{async setBadgeText(value){badges.push(value);},async openPopup(){opens++;if(failOpen)throw Error('user gesture required');}}
  };
  const store = {async loadConfig(){return {config:structuredClone(config)};},async saveConfig(value){config=structuredClone(value);saves++;return {ok:true};}};
  const controller = createManualGroupController(api,store,async()=>{syncs++;});
  const capture=()=>controller.capture(10,{groupId:tabs[0].groupId},tabs[0]);
  return {api,store,controller,tabs,groups,badges,capture,get config(){return config;},get opens(){return opens;},get saves(){return saves;},get syncs(){return syncs;},set failOpen(v){failOpen=v;}};
}

test('网站默认路径：保留协议主机端口，去掉账号路径与参数，排除受限页面',()=>{
  assert.equal(websitePattern('https://user:pass@example.com:8443/a?q=token#x'),'https://example.com:8443/*');
  assert.equal(websitePattern('http://[::1]:3000/a'),'http://[::1]:3000/*');
  for(const value of ['about:blank','file:///tmp/a','invalid'])assert.equal(websitePattern(value),null);
});

test('匹配地址：复用简写扩写，拒绝无效协议、空串、账号与非法主机',()=>{
  assert.deepEqual(expandWebsiteInput('new.example'),['*://new.example:*/*','*://new.example/*']);
  assert.deepEqual(expandWebsiteInput('https://new.example/*'),['https://new.example/*']);
  for(const value of ['', 'https://', 'file://example.com', 'https://user:pass@example.com', 'bad host', 'https://example.com:bad/'])assert.deepEqual(expandWebsiteInput(value),[]);
});

test('手动归组：提示并持久化，保存扩写去重且同步，保留已有配置',async()=>{
  const f=fixture(); await f.capture();
  const item=await f.controller.pending(1);
  assert.equal(item.pattern,'https://new.example:8443/*');
  assert.equal(item.name,'工作');assert.equal(f.opens,1);assert.equal(f.saves,0);
  assert.equal(await f.controller.pending(2),null);
  const result=await f.controller.add(1,item.id,'new.example');
  assert.equal(result.ok,true);
  assert.deepEqual(f.config.rules[0].patterns,['https://old.example/*','*://new.example:*/*','*://new.example/*']);
  assert.equal(f.syncs,1);assert.equal(await f.controller.pending(1),null);
});

test('手动归组：无法自动打开 popup 时保留待确认和角标，取消不改配置',async()=>{
  const f=fixture();f.failOpen=true;await f.capture();
  const item=await f.controller.pending(1);assert.ok(item);
  assert.equal(f.badges.at(-1).text,'1');
  await f.controller.cancel(1,item.id);
  assert.equal(f.saves,0);assert.equal(f.syncs,0);assert.equal(await f.controller.pending(1),null);
  assert.equal(f.tabs[0].groupId,3);
});

test('手动归组：无对应规则、已覆盖、插件自动归组均静默',async()=>{
  for(const mode of ['unmanaged','covered','automatic']){
    const f=fixture();
    if(mode==='unmanaged')f.groups[0].title='手动组';
    if(mode==='covered')f.tabs[0].url='https://old.example/a';
    if(mode==='automatic')markAutomaticGrouping([10],3);
    await f.capture();assert.equal(await f.controller.pending(1),null);assert.equal(f.opens,0);
  }
  clearAutomaticGrouping([10]);
});

test('手动归组：移走、导航到其他网站、删除规则后不能确认保存',async()=>{
  for(const mode of ['moved','navigated','rule-deleted']){
    const f=fixture();await f.capture();const item=await f.controller.pending(1);
    if(mode==='moved')f.tabs[0].groupId=-1;
    if(mode==='navigated')f.tabs[0].url='https://other.example';
    if(mode==='rule-deleted')f.config.rules=[];
    const result=await f.controller.add(1,item.id,item.pattern);
    assert.equal(result.ok,false);assert.equal(f.saves,0);
  }
});

test('手动归组：无效输入不保存，重复归组事件只保留该标签最后一项',async()=>{
  const f=fixture();await f.capture();await f.capture();
  const item=await f.controller.pending(1);
  assert.equal(f.badges.at(-1).text,'1');
  assert.equal((await f.controller.add(1,item.id,'')).reason,'invalid-pattern');
  assert.equal(f.saves,0);
  assert.ok(await f.controller.pending(1));
});

test('手动归组：重新建立后台控制器后仍可读取待确认项',async()=>{
  const f=fixture();await f.capture();
  const reloaded=createManualGroupController(f.api,f.store);
  assert.equal((await reloaded.pending(1)).pattern,'https://new.example:8443/*');
});

test('手动归组：确认重复地址不追加重复项，保存失败不消耗待确认',async()=>{
  const f=fixture();await f.capture();let item=await f.controller.pending(1);
  const save=f.store.saveConfig;
  f.store.saveConfig=async()=>({ok:false});
  assert.equal((await f.controller.add(1,item.id,'new.example')).reason,'save-failed');
  assert.ok(await f.controller.pending(1));
  f.store.saveConfig=save;
  f.config.rules[0].patterns.push('*://new.example/*');
  assert.equal((await f.controller.add(1,item.id,'new.example')).ok,true);
  assert.equal(f.config.rules[0].patterns.filter(p=>p==='*://new.example/*').length,1);
});

test('实际动作层归组事件不会生成手动添加提示',async()=>{
  const f=fixture();
  f.tabs[0].groupId=-1;
  f.api.tabGroups.query=async()=>f.groups;
  f.api.tabGroups.update=async()=>{};
  f.api.tabs.group=async()=>{
    f.tabs[0].groupId=3;
    await f.capture();
    return 3;
  };
  globalThis.browser=f.api;
  const actions=await import('../src/app/actions.js');
  const result=await actions.apply({...f.config.rules[0],color:'blue',collapsed:false},f.tabs[0],{tabs:f.tabs});
  assert.equal(result[0].ok,true);
  assert.equal(f.opens,0);
  assert.equal(await f.controller.pending(1),null);
});

test('关闭自动更新：不捕获新请求，清空已有请求和角标',async()=>{
  const f=fixture();await f.capture();const item=await f.controller.pending(1);
  f.config.autoUpdateGroupRules=false;
  await f.controller.settingsChanged();
  assert.equal(await f.controller.pending(1),null);
  assert.equal(f.badges.at(-1).text,'');
  assert.equal((await f.controller.add(1,item.id,item.pattern)).ok,false);
  await f.capture();assert.equal(f.opens,1);assert.equal(f.saves,0);
  f.config.autoUpdateGroupRules=true;
  await f.capture();assert.ok(await f.controller.pending(1));assert.equal(f.opens,2);
});

test('关闭自动更新：重新打开 popup 时忽略持久化待确认项',async()=>{
  const f=fixture();await f.capture();
  f.config.autoUpdateGroupRules=false;
  const reloaded=createManualGroupController(f.api,f.store);
  assert.equal(await reloaded.pending(1),null);
  assert.equal(f.badges.at(-1).text,'');
});
