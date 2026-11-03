import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines} from '../src/diff.js';
import {changedFilesOf} from '../src/changed-files.js';

test('unified hunks show the correct before and after line numbers across multiple hunks',()=>{
 const rows=diffLines('--- a/a.js\n+++ b/a.js\n@@ -3,2 +3,3 @@\n context\n-old\n+new\n++plus\n\\ No newline at end of file\n@@ -10 +11 @@\n-last\n+done\n');
 assert.deepEqual(rows.filter(r=>['add','delete','context'].includes(r.type)),[
  {type:'context',text:'context',oldLine:3,newLine:3},
  {type:'delete',text:'old',oldLine:4,newLine:null},
  {type:'add',text:'new',oldLine:null,newLine:4},
  {type:'add',text:'+plus',oldLine:null,newLine:5},
  {type:'delete',text:'last',oldLine:10,newLine:null},
  {type:'add',text:'done',oldLine:null,newLine:11}
 ]);
 assert.equal(rows.filter(r=>r.type==='hunk').length,2);
 assert.equal(rows.filter(r=>r.type==='meta').length,3);
});
test('raw added/deleted content keeps source prefixes and blank lines intact',()=>{
 assert.deepEqual(diffLines('+literal\n\nlast\n','add'),[
  {type:'add',text:'+literal',oldLine:null,newLine:1},
  {type:'add',text:'',oldLine:null,newLine:2},
  {type:'add',text:'last',oldLine:null,newLine:3}
 ]);
 assert.deepEqual(diffLines('-literal\r\n','delete'),[{type:'delete',text:'-literal',oldLine:1,newLine:null}]);
 assert.deepEqual(diffLines('','add'),[]);
 assert.deepEqual(diffLines('Binary files differ\n'),[{type:'meta',text:'Binary files differ'}]);
});
test('file aggregation retains successful patches in order across updates, renames and deletions',()=>{
 const original={status:'completed',items:[
  {type:'fileChange',status:'completed',changes:[{path:'a.js',kind:{type:'update'},diff:'@@ -1 +1 @@\n-old\n+new'}]},
  {type:'fileChange',status:'failed',changes:[{path:'a.js',kind:{type:'update'},diff:'failed patch'}]},
  {type:'fileChange',status:'completed',changes:[{path:'a.js',kind:{type:'update',move_path:'b.js'},diff:'@@ -1 +1 @@\n-new\n+renamed'}]},
  {type:'fileChange',status:'completed',changes:[{path:'removed.txt',kind:{type:'delete'},diff:'deleted contents\n'}]}
 ]};
 const files=changedFilesOf(original);
 assert.equal(files[0].path,'b.js');
 assert.equal(files[0].diffs.length,2);
 assert.match(files[0].diffs[0].text,/-old/);
 assert.match(files[0].diffs[1].text,/\+renamed/);
 assert.equal(files[1].diffs[0].kind,'delete');
 assert.equal(original.items[0].changes[0].path,'a.js');
});
