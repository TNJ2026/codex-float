import test from 'node:test';
import assert from 'node:assert/strict';
import jsonpatch from 'fast-json-patch';
import {applyChange} from '../src/model.js';

const update=(state,patches)=>applyChange(state,1,{baseRevision:1,revision:2,patches}).state;
test('incremental updates share untouched history and never mutate the previous snapshot', () => {
 const previous={history:{old:{text:'history'},current:{text:'before'}},runtime:{active:true}};
 const next=update(previous,[{op:'replace',path:['history','current','text'],value:'after'}]);
 assert.equal(previous.history.current.text,'before');
 assert.equal(next.history.current.text,'after');
 assert.equal(next.history.old,previous.history.old);
 assert.equal(next.runtime,previous.runtime);
 assert.notEqual(next.history,previous.history);
});
test('JSON patch operations match the original implementation for arrays, escaped paths and root changes', () => {
 const original={list:[{text:'a'},{text:'b'}], 'a/b':{'~key':1}};
 const sequences=[
  [{op:'add',path:'/list/-',value:{text:'c'}},{op:'replace',path:'/list/0/text',value:'changed'},{op:'remove',path:'/list/1'}],
  [{op:'replace',path:'/a~1b/~0key',value:2}],
  [{op:'copy',from:'/list/0',path:'/copied'},{op:'replace',path:'/copied/text',value:'copy'}],
  [{op:'move',from:'/list/0',path:'/list/1'}],
  [{op:'test',path:'/list/0/text',value:'a'}],
  [{op:'replace',path:'',value:{newRoot:true}}],
  [{op:'add',path:'/new',value:{text:'first'}},{op:'replace',path:'/new/text',value:'second'}]
 ];
 for(const patches of sequences){
  const before=structuredClone(original);
  assert.deepEqual(update(original,patches),jsonpatch.applyPatch(original,patches,true,false).newDocument);
  assert.deepEqual(original,before);
 }
});
test('invalid patches, stale revisions and unsafe paths cannot corrupt existing state', () => {
 const original={nested:{text:'original'}};
 for(const patches of [
  [{op:'replace',path:'/missing/text',value:'bad'}],
  [{op:'replace',path:'/nested/text',value:'changed'},{op:'remove',path:'/missing'}],
  [{op:'add',path:'/__proto__/polluted',value:true}]
 ])assert.throws(()=>update(original,patches));
 assert.deepEqual(original,{nested:{text:'original'}});
 assert.equal({}.polluted,undefined);
 assert.throws(()=>applyChange(original,1,{baseRevision:0,patches:[]}));
});
