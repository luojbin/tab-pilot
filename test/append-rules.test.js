import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRules } from '../src/core/append-rules.js';

const rule=(id,name)=>({id,name,enabled:true,patterns:['https://example.com/*'],highlight:{enabled:true,border:{sides:['top']}}});

test('追加规则：保留全局设置及现有顺序，副本数据相互独立',()=>{
  const current={schemaVersion:1,language:'en',strictMode:true,clickAction:'syncCollapseAll',showActionResult:false,rules:[rule('a','工作')]};
  const imported=[{...rule('b','开发'),enabled:false,note:'原备注',titleRule:{enabled:true,rules:[{pattern:'x',replacement:'y'}]}}];
  const original=structuredClone({current,imported});
  const merged=appendRules(current,imported,()=> 'new-id');
  assert.deepEqual({...merged,rules:[]},{...current,rules:[]});
  assert.deepEqual(merged.rules,[...current.rules,...imported]);
  merged.rules[1].highlight.border.sides.push('bottom');
  merged.rules[1].titleRule.rules[0].replacement='changed';
  assert.deepEqual({current,imported},original);
});

test('追加规则：同名增加导入后缀，连续冲突递增，id 冲突重新生成',()=>{
  const current={rules:[rule('a','工作'),rule('b','工作-导入'),rule('c','工作-导入-2')]};
  let index=0;
  const merged=appendRules(current,[rule('a',' 工作 '),rule('b','工作')],()=>`new-${++index}`);
  assert.deepEqual(merged.rules.map(rule=>rule.name),['工作','工作-导入','工作-导入-2','工作-导入-3','工作-导入-4']);
  assert.equal(new Set(merged.rules.map(rule=>rule.id)).size,5);
  assert.equal(current.rules.length,3);
});

test('追加规则：文件内同名也去重，空规则列表不改动现有配置',()=>{
  const current={rules:[]};
  const merged=appendRules(current,[rule('a','工作'),rule('b','工作')],()=> 'new-id');
  assert.deepEqual(merged.rules.map(rule=>rule.name),['工作','工作-导入']);
  assert.deepEqual(appendRules(current,[],()=> 'new-id'),current);
});
