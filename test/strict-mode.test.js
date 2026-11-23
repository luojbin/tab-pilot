import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceStrictGroup } from '../src/app/strict-mode.js';

function fixture() {
  const tab={id:1,windowId:2,groupId:3,pinned:false,url:'https://other.example/page'};
  const eventTab={...tab};
  const group={id:3,windowId:2,title:'工作'};
  const config={rules:[{strictMode:true,name:'工作',enabled:true,minTabs:5,patterns:['https://work.example/*']}]};
  const removed=[];
  const api={tabs:{async get(){return {...tab};},async ungroup(id){removed.push(id);}},tabGroups:{async get(){return {...group};}}};
  return {tab,eventTab,group,config,removed,run:()=>enforceStrictGroup(api,config,eventTab)};
}

test('严格模式：跨站跳转移出原组，同站或路径仍匹配则保留，不受分组阈值影响',async()=>{
  const f=fixture();
  assert.equal(await f.run(),true);assert.deepEqual(f.removed,[1]);
  f.tab.url='https://work.example/other/path';
  assert.equal(await f.run(),false);assert.equal(f.removed.length,1);
});

test('严格模式：路径、协议与重定向后网址也参与匹配',async()=>{
  const f=fixture();f.config.rules[0].patterns=['https://work.example/app/*'];
  for(const url of ['https://work.example/elsewhere','http://work.example/app/a']){
    f.tab.url=url;assert.equal(await f.run(),true);
  }
  f.tab.url='https://work.example/app/a';
  f.tab.pendingUrl='https://redirect.example/';
  assert.equal(await f.run(),true);
});

test('严格模式：缺省关闭、停用规则、无对应规则均不移出',async()=>{
  for(const mode of ['off','missing','disabled','unmanaged','duplicate']){
    const f=fixture();
    if(mode==='off')f.config.rules[0].strictMode=false;
    if(mode==='missing')delete f.config.rules[0].strictMode;
    if(mode==='disabled')f.config.rules[0].enabled=false;
    if(mode==='unmanaged')f.group.title='手动组';
    if(mode==='duplicate')f.config.rules.push({...f.config.rules[0]});
    assert.equal(await f.run(),false);assert.deepEqual(f.removed,[]);
  }
});

test('严格模式：固定标签、过期归属及临时内部页不移出',async()=>{
  for(const mode of ['pinned','group-changed','window-changed','ungrouped','blank']){
    const f=fixture();
    if(mode==='pinned')f.tab.pinned=true;
    if(mode==='group-changed')f.tab.groupId=4;
    if(mode==='window-changed')f.tab.windowId=3;
    if(mode==='ungrouped')f.eventTab.groupId=-1;
    if(mode==='blank')f.tab.url='about:blank';
    assert.equal(await f.run(),false);assert.deepEqual(f.removed,[]);
  }
});

test('严格模式逐组独立：其他规则开启不影响当前关闭的组',async()=>{
  const f=fixture();
  f.config.rules.push({name:'资料',enabled:true,strictMode:false,patterns:['https://docs.example/*']});
  f.group.title='资料';
  assert.equal(await f.run(),false);
  f.config.rules[1].strictMode=true;
  assert.equal(await f.run(),true);
  f.config.rules[0].strictMode=false;
  f.group.title='工作';
  assert.equal(await f.run(),false);
  assert.deepEqual(f.removed,[1]);
});
