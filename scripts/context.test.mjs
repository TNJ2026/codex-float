import test from 'node:test';
import assert from 'node:assert/strict';
import {contextMessage,contextKey,contextMatches,mergeContexts,mentionAt} from '../src/context.js';

test('mentions respect caret position and avoid email addresses and selected suffixes',()=>{
 assert.deepEqual(mentionAt('检查 @src/main'),{start:3,end:12,query:'src/main',trigger:'@'});
 assert.deepEqual(mentionAt('$documents'),{start:0,end:10,query:'documents',trigger:'$'});
 assert.equal(mentionAt('me@example.com'),null);
 assert.equal(mentionAt('第一行\n下一行'),null);
 assert.deepEqual(mentionAt('看 @src 后续',6),{start:2,end:6,query:'src',trigger:'@'});
});
test('contexts deduplicate by content and source while preserving distinct selections',()=>{
 const file={kind:'file',label:'a',path:'C:/a'},snippet={kind:'snippet',label:'selection',path:'C:/a',content:'line 1'};
 assert.deepEqual(mergeContexts([file],[file,snippet,{...snippet,content:'line 2'}]).length,3);
 assert.notEqual(contextKey(snippet),contextKey({...snippet,content:'line 2'}));
 assert.throws(()=>mergeContexts([],[{kind:'unknown',label:'excluded'}]),/不支持/);
 assert.throws(()=>mergeContexts([],Array.from({length:21},(_,index)=>({...file,path:`C:/${index}`}))),/20/);
});
test('file, folder, skill and plugin references are preserved as readable context',()=>{
 const items=[{kind:'file',label:'a [1].js',path:'C:\\src\\a [1].js'},{kind:'folder',label:'src',path:'C:/src'},{kind:'skill',label:'test',path:'C:/skill/SKILL.md'},{kind:'plugin',label:'Documents',path:'plugin://documents@local'}];
 const text=contextMessage('请检查',items);
 assert.match(text,/上下文文件：\[a \\\[1\\\]\.js\]\(<C:\/src\/a \[1\]\.js>\)/u);
 assert.ok(text.includes('上下文目录：[src](<C:/src>)'));
 assert.ok(text.includes('使用技能：[test](<C:/skill/SKILL.md>)'));
 assert.ok(text.includes('使用插件：[Documents](plugin://documents@local)'));
});
test('snippets retain source lines and embedded code fences, browser selections remain quoted',()=>{
 const text=contextMessage('',[{kind:'snippet',label:'选中代码',path:'C:/a.js',content:'```js\nconst x=1\n```',language:'js',startLine:5},{kind:'browser',label:'Example',url:'https://example.com',content:'选中一行\n第二行'}]);
 assert.ok(text.includes('（从第 5 行开始）\n\n````js\n```js'));
 assert.ok(text.includes('网页选中内容：\n> 选中一行\n> 第二行'));
 assert.equal(contextMatches({label:'资料',path:'C:/Project/src/main.js'},'project MAIN'),true);
});

test('other conversations are readable references deduplicated by conversation ID',()=>{
 const item={kind:'thread',label:'项目 [计划]',path:'codex://threads/00000000-0000-4000-8000-000000000001',source:'项目甲'};
 assert.equal(mergeContexts([item],[{...item,label:'重命名后的标题'}]).length,1);
 assert.equal(contextMessage('参考这个对话',[item]),'参考这个对话\n\n参考对话：[项目 \\[计划\\]](codex://threads/00000000-0000-4000-8000-000000000001)');
 assert.equal(contextMatches(item,'项目甲'),true);
});
