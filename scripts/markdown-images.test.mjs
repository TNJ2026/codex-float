import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('Markdown renders safe local, remote and inline images while stripping active content',async()=>{
 const dom=new JSDOM('');
 const previous=globalThis.window;
 globalThis.window=dom.window;
 dom.window.__TAURI_INTERNALS__={convertFileSrc:path=>`http://asset.localhost/${encodeURIComponent(path)}`};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {Markdown}=await vite.ssrLoadModule('/src/Markdown.jsx');
  const render=props=>new JSDOM(renderToStaticMarkup(React.createElement(Markdown,props))).window.document;
  const doc=render({text:'![本地](<C:/图片/a b.png>)\n\n![网络](https://example.com/a.png)\n\n![内嵌](data:image/png;base64,AAAA)',images:[{id:'attachment',src:'C:/attachment.png',alt:'附件'}]});
  const images=[...doc.querySelectorAll('img')];
  assert.equal(images.length,4);
  assert.equal(images[0].getAttribute('src'),'http://asset.localhost/'+encodeURIComponent('C:/图片/a b.png'));
  assert.equal(images[1].getAttribute('src'),'https://example.com/a.png');
  assert.equal(images[2].getAttribute('src'),'data:image/png;base64,AAAA');
  assert.equal(images[3].alt,'附件');
  for(const image of images){
   assert.equal(image.getAttribute('loading'),'lazy');
   assert.equal(image.getAttribute('referrerpolicy'),'no-referrer');
   assert.equal(image.hasAttribute('data-image-source'),false);
  }
  const unsafe=render({text:'<script>alert(1)</script><iframe src="https://example.com"></iframe><img src="javascript:alert(1)" onerror="alert(1)" srcset="https://example.com/tracker.png 2x"><img data-image-source="javascript:alert(2)"><img src="data:text/html;base64,AAAA">'});
  assert.equal(unsafe.querySelector('script,iframe,[onerror],[srcset]'),null);
  assert.ok([...unsafe.querySelectorAll('img')].every(image=>!image.hasAttribute('src')));
  const source='const message = "<img src=x onerror=alert(1)>";\n// 中文';
  const highlighted=render({text:'```js\n'+source+'\n```\n\n```unknown\n<script>example</script>\n```'});
  assert.ok(highlighted.querySelector('pre .language-javascript .hljs-keyword'));
  assert.equal(highlighted.querySelector('.language-javascript').textContent,source);
  assert.equal(highlighted.querySelector('.language-plaintext').textContent,'<script>example</script>');
  assert.equal(highlighted.querySelector('script,img,[onerror]'),null);
 }finally{
  await vite.close();globalThis.window=previous;dom.window.close();
 }
});
