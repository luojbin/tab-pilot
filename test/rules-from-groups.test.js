import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFromGroups } from '../src/core/rules-from-groups.js';

const group=(id,title,windowId=1)=>({id,title,windowId,color:'blue',collapsed:false});
const tab=(id,groupId,url,index,windowId=1)=>({id,groupId,url,index,windowId});
const ids=()=>{let id=0;return ()=>`generated-${++id}`;};

test('窗口分组生成规则：保留名称颜色折叠，按标签顺序生成网站 origin 并去重',()=>{
  const groups=[{...group(1,'开发'),collapsed:true},group(2,'工作')];
  const tabs=[tab(1,1,'http://localhost:3000/a',0),tab(2,1,'http://localhost:3000/b?q=secret',1),tab(3,1,'https://user:pass@dev.example/path#fragment',2),tab(4,2,'https://work.example/a',3)];
  const original=structuredClone({groups,tabs});
  const rules=rulesFromGroups([],groups,tabs,1,ids());
  assert.deepEqual(rules[0],{id:'generated-1',name:'开发',enabled:true,color:'blue',collapsed:true,strictMode:false,minTabs:1,note:'',patterns:['http://localhost:3000/*','https://dev.example/*']});
  assert.deepEqual(rules[1].patterns,['https://work.example/*']);
  assert.deepEqual({groups,tabs},original);
});

test('窗口分组生成规则：已有同名规则（含停用）跳过，不改动现有草稿',()=>{
  const existing=[{id:'a',name:' 工作 ',enabled:false,patterns:['https://old.example/*']}];
  const groups=[group(1,'工作'),group(2,'新组')];
  const tabs=[tab(1,1,'https://new.example/',0),tab(2,2,'https://fresh.example/',1)];
  const before=structuredClone(existing);
  const generated=rulesFromGroups(existing,groups,tabs,1,ids());
  assert.deepEqual(generated.map(rule=>rule.name),['新组']);
  assert.deepEqual(existing,before);
  assert.deepEqual(rulesFromGroups([...existing,...generated],groups,tabs,1,ids()),[]);
});

test('窗口分组生成规则：严格限制窗口，跳过无名称、非网站、固定和游离标签',()=>{
  const groups=[group(1,'此窗口'),group(2,'其他窗口',2),group(3,''),group(4,'内部页')];
  const tabs=[tab(1,1,'https://ok.example/',0),tab(2,2,'https://other.example/',0,2),tab(3,3,'https://unnamed.example/',1),tab(4,4,'about:blank',2),tab(5,-1,'https://loose.example/',3),{...tab(6,1,'https://pinned.example/',4),pinned:true}];
  assert.deepEqual(rulesFromGroups([],groups,tabs,1,ids()).map(rule=>rule.patterns),[['https://ok.example/*']]);
});

test('窗口分组生成规则：按当前标签组顺序追加，同名原生组合并网站模式',()=>{
  const groups=[group(1,'同名'),group(3,'最后'),group(2,'同名')];
  const tabs=[tab(1,2,'http://second.example/',0),tab(2,1,'https://first.example/',1),tab(3,3,'https://last.example/',2)];
  const generated=rulesFromGroups([],groups,tabs,1,ids());
  assert.deepEqual(generated.map(rule=>rule.name),['同名','最后']);
  assert.deepEqual(generated[0].patterns,['http://second.example/*','https://first.example/*']);
});

test('窗口分组生成规则：生成唯一 id，空窗口不生成数据',()=>{
  const createId=ids();
  const generated=rulesFromGroups([{id:'generated-1',name:'已有'}],[group(1,'新组')],[tab(1,1,'https://new.example/',0)],1,createId);
  assert.equal(generated[0].id,'generated-2');
  assert.deepEqual(rulesFromGroups([],[],[],1,createId),[]);
});
