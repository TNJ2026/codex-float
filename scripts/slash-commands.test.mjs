import test from 'node:test';
import assert from 'node:assert/strict';
import {slashAt,slashRows} from '../src/slash-commands.js';

test('slash completion only recognizes a leading command and searches commands and skills',()=>{
 assert.equal(slashAt('https://example.com'),null);
 assert.equal(slashAt('please /model'),null);
 assert.equal(slashAt('/tmp/file'),null);
 assert.equal(slashAt('code\n/model'),null);
 assert.deepEqual(slashAt(' /mod'),{start:0,end:5,text:' /mod',query:'mod'});
 assert.equal(slashRows('model',[],false)[0].id,'model');
 assert.equal(slashRows('压缩',[],true)[0].disabled,true);
 assert.equal(slashRows('compact',[],false)[0].disabled,false);
 assert.equal(slashRows('goal',[],false).length,0);
 assert.equal(slashRows('目标模式',[],false).length,0);
 const skill={kind:'skill',label:'test-skill',path:'C:/skills/test/SKILL.md',description:'Create a report'};
 const match=slashRows('report',[skill],false)[0];
 assert.equal(match.kind,'skill');assert.equal(match.skill,skill);
 assert.equal(slashRows('missing',[skill],false).length,0);
});
