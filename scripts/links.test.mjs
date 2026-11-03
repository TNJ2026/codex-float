import test from 'node:test';
import assert from 'node:assert/strict';
import {linkTarget} from '../src/links.js';

test('HTTP links always use the default browser, including remote images',()=>{
 assert.deepEqual(linkTarget('https://example.com/a.png'),{kind:'url',url:'https://example.com/a.png'});
 assert.deepEqual(linkTarget('HTTP://example.com'),{kind:'url',url:'http://example.com/'});
});
test('local image and text links normalize desktop paths, file URIs and source lines',()=>{
 assert.deepEqual(linkTarget('/C:/图片/a.png'),{kind:'image',path:'C:/图片/a.png'});
 assert.deepEqual(linkTarget('file:///C:/a%20b/README.md#L2'),{kind:'text',path:'C:/a b/README.md'});
 assert.deepEqual(linkTarget('D:/src/app.rs:12:4'),{kind:'text',path:'D:/src/app.rs'});
 assert.deepEqual(linkTarget('README.md#L12','D:/project'),{kind:'text',path:'D:/project/README.md'});
 assert.deepEqual(linkTarget('./a.PNG','D:/project/'),{kind:'image',path:'D:/project/./a.PNG'});
 assert.deepEqual(linkTarget('C:\\data\\file.txt'),{kind:'text',path:'C:\\data\\file.txt'});
});
test('reject executable schemes and network shares without invoking the OS',()=>{
 for(const href of ['javascript:alert(1)','data:text/html,hi','mailto:a@example.com','\\\\server\\file.txt','file://server/share/a.txt','//server/a.txt','https://example.com/\na',''])assert.throws(()=>linkTarget(href));
 assert.throws(()=>linkTarget('relative.txt'));
 assert.deepEqual(linkTarget('#heading'),{kind:'anchor',id:'heading'});
});
