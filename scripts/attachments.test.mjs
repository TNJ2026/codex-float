import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentMessage,mergeAttachments,MAX_ATTACHMENT_BYTES,fileData} from '../src/attachments.js';
import {hasMessageEcho} from '../src/optimistic.js';

test('attachments deduplicate paths, preserve selection order and reject overflow',()=>{
 const a={path:'C:\\文件\\a.txt',name:'a.txt'},b={path:'C:/文件/b.png',name:'b.png',image:true};
 assert.deepEqual(mergeAttachments([a],[{...a,path:'C:/文件/a.txt'},b]),[a,b]);
 assert.throws(()=>mergeAttachments([],Array.from({length:21},(_,i)=>({path:`C:/${i}`}))),/20/);
});
test('file attachments retain Unicode, spaces and safe link labels while images stay image inputs',()=>{
 const files=[{path:'C:\\文件\\a [1]%.txt',name:'a [1]%.txt'}, {path:'C:/image.png',name:'image.png',image:true}];
 assert.equal(attachmentMessage(' 检查 ',files),'检查\n\n[附件：a \\[1\\]%.txt](<C:/文件/a [1]%25.txt>)');
});
test('image-only submissions cannot be acknowledged by a different image',()=>{
 const local={id:'local',text:'',images:[{src:'C:\\image.png'}],baselineIds:new Set()};
 assert.equal(hasMessageEcho([{id:'other',role:'user',text:'',images:[{src:'C:/other.png'}]}],local),false);
 assert.equal(hasMessageEcho([{id:'echo',role:'user',text:'',images:[{src:'C:/image.png'}]}],local),true);
});
test('oversized pasted files are rejected before reading contents',async()=>{
 await assert.rejects(fileData({size:MAX_ATTACHMENT_BYTES+1}),/25 MB/);
});
