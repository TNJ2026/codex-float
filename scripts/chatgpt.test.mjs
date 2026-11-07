import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeChatGPTTurns,chatGPTBusy} from '../src/chatgpt.js';

test('ChatGPT polling updates overlapping turns and retains loaded older pages',()=>{
 const a={id:'a'},b={id:'b',text:'partial'},c={id:'c'},bFinal={id:'b',text:'final'};
 assert.deepEqual(mergeChatGPTTurns([], [b,a]),[a,b]);
 assert.deepEqual(mergeChatGPTTurns([a,b], [c,bFinal]),[a,bFinal,c]);
 assert.deepEqual(mergeChatGPTTurns([b,c], [bFinal,a],{older:true}),[a,bFinal,c]);
 assert.equal(chatGPTBusy({status:{type:'active'}}),true);
 assert.equal(chatGPTBusy({status:{type:'idle'}}),false);
});
