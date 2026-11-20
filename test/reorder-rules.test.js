import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderRules } from '../src/core/reorder-rules.js';
import { createRuleDrag } from '../src/ui/rule-drag.js';

const rules = ['a','b','c','d'].map(id => ({id,name:id,enabled:id!=='b',patterns:[id]}));

test('规则拖拽排序：向前、向后及首尾移动，保留规则数据和其他规则顺序',()=>{
  for(const [source,target,after,expected] of [
    ['d','a',false,'dabc'],['a','d',true,'bcda'],['b','d',false,'acbd'],['d','b',true,'abdc']
  ]) {
    const next=reorderRules(rules,source,target,after);
    assert.equal(next.map(rule=>rule.id).join(''),expected);
    for(const rule of next)assert.equal(rule,rules.find(item=>item.id===rule.id));
    assert.equal(rules.map(rule=>rule.id).join(''),'abcd');
  }
});

test('规则拖拽排序：同项、相邻原位置与无效目标不产生修改',()=>{
  for(const args of [['a','a'],['a','b',false],['b','a',true],['missing','a'],['a','__global__']]) {
    assert.equal(reorderRules(rules,...args),rules);
  }
});

function fixture() {
  function node() {
    const classes=new Set();
    return {handlers:{},classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains(name){return classes.has(name);}},
      addEventListener(name,fn){this.handlers[name]=fn;},getBoundingClientRect(){return {top:0,height:40};}};
  }
  const list=node();
  const items=[node(),node()];
  const rows=[node(),node()];
  list.querySelectorAll=()=>items;
  list.contains=element=>items.includes(element)||rows.includes(element);
  const moves=[];let started=0;let allowed=true;
  const bind=createRuleDrag(list,(...args)=>moves.push(args),()=>started++,()=>allowed);
  rows.forEach((row,index)=>bind(row,items[index],String(index)));
  const event=(y=0)=>({clientY:y,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},dataTransfer:{setData(type,value){this.data=[type,value];}},target:{closest(){return null;}}});
  return {list,items,rows,moves,event,get started(){return started;},set allowed(value){allowed=value;}};
}

test('拖拽事件：显示插入位置，仅放下时提交排序，结束清理状态',()=>{
  const f=fixture();const start=f.event();
  f.rows[0].handlers.dragstart(start);
  assert.equal(start.dataTransfer.effectAllowed,'move');assert.equal(f.started,1);
  const over=f.event(35);f.items[1].handlers.dragover(over);
  assert.equal(over.prevented,true);assert.equal(f.items[1].classList.contains('drop-after'),true);
  assert.deepEqual(f.moves,[]);
  f.items[1].handlers.drop(f.event(35));
  assert.deepEqual(f.moves,[['0','1',true]]);
  assert.equal(f.items[0].classList.contains('dragging'),false);
  assert.equal(f.items[1].classList.contains('drop-after'),false);
});

test('拖拽事件：忽略外部拖入、按钮发起和忙碌状态，取消不改变顺序',()=>{
  const f=fixture();const external=f.event();
  f.items[1].handlers.dragover(external);f.items[1].handlers.drop(external);
  assert.equal(external.prevented,false);assert.deepEqual(f.moves,[]);
  const pointer=f.event();pointer.target.closest=()=>({});f.rows[0].handlers.pointerdown(pointer);
  const blocked=f.event();f.rows[0].handlers.dragstart(blocked);assert.equal(blocked.prevented,true);
  f.rows[0].handlers.pointerdown(f.event());
  f.rows[0].handlers.dragstart(f.event());f.rows[0].handlers.dragend();
  assert.deepEqual(f.moves,[]);assert.equal(f.items[0].classList.contains('dragging'),false);
  f.allowed=false;const busy=f.event();f.rows[0].handlers.dragstart(busy);assert.equal(busy.prevented,true);
});
