import test from 'node:test';
import assert from 'node:assert/strict';
import {imageSource,imagesOf,generatedImagesOf} from '../src/images.js';
import {messagesOf} from '../src/model.js';

test('local image paths preserve spaces, Unicode and encoded file URLs',()=>{
 const convert=path=>`asset:${path}`;
 assert.equal(imageSource('C:\\图片\\a b.PNG',convert),'asset:C:\\图片\\a b.PNG');
 assert.equal(imageSource('/tmp/a b.png',convert),'asset:/tmp/a b.png');
 assert.equal(imageSource('/C:/图片/a b.png',convert),'asset:C:/图片/a b.png');
 assert.equal(imageSource('file:///C:/a%20b%23c.png',convert),'asset:C:/a b#c.png');
 assert.equal(imageSource('file:///tmp/a%20b.png',convert),'asset:/tmp/a b.png');
 assert.equal(imageSource('C:/a.png'),'');
});
test('network and inline raster images work; executable URLs and network shares are rejected',()=>{
 for(const source of ['https://example.com/a.png','http://localhost/a.jpg','data:image/png;base64,AAAA'])assert.equal(imageSource(source),source);
 for(const source of ['javascript:alert(1)','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','//example.com/a.png','file://server/share/a.png','file:///bad%ZZ','\\\\server\\a.png','https://example.com/\na.png'])assert.equal(imageSource(source,path=>path),'');
});
test('image-only messages survive parsing alongside mixed text and image attachments',()=>{
 const messages=messagesOf({turns:[{items:[
  {id:'image',type:'userMessage',content:[{type:'localImage',path:'C:/a.png'}]},
  {id:'mixed',type:'steeringUserMessage',input:[{type:'text',text:'看这个'},{type:'image',image_url:{url:'https://example.com/b.png'}}]},
  {id:'empty',type:'userMessage',content:[]},
  {id:'context',type:'userMessage',content:[{type:'text',text:'<external_codex_apps_open_page>{}</external_codex_apps_open_page>'}]},
  {id:'reply',type:'agentMessage',text:'![图片](C:/a.png)'}
 ]}]});
 assert.deepEqual(messages.map(message=>message.id),['image','mixed','reply']);
 assert.equal(messages[0].text,'');
 assert.equal(messages[0].images[0].src,'C:/a.png');
 assert.equal(messages[1].text,'看这个');
 assert.equal(messages[1].images[0].src,'https://example.com/b.png');
 assert.deepEqual(imagesOf([{type:'input_image',image_url:'data:image/png;base64,AAAA'}]).map(image=>image.src),['data:image/png;base64,AAAA']);
});
test('unchanged attachments retain identity across conversation updates',()=>{
 const content=[{type:'localImage',path:'C:/a.png'}];
 assert.equal(imagesOf(content),imagesOf(content));
 assert.equal(imagesOf([]),imagesOf(undefined));
 assert.notEqual(imagesOf([...content,{type:'image',url:'https://example.com/b.png'}]),imagesOf(content));
});
test('completed desktop imageGeneration items appear in order between assistant messages',()=>{
 const generated={id:'generated',type:'imageGeneration',status:'completed',result:'iVBORw0KGgoAAAA=',savedPath:'C:/missing.png',src:'/C:/missing.png'};
 const items=[{id:'before',type:'agentMessage',text:'生成横幅'},generated,{id:'after',type:'agentMessage',text:'横幅已完成'}];
 for(const state of [{turns:[{items}]},{turnHistory:{history:{entitiesByKey:{turn:{items:{entitiesByKey:Object.fromEntries(items.map(i=>[i.id,i]))}}}}}}]){
  const messages=messagesOf(state);
  assert.deepEqual(messages.map(m=>m.id),['before','generated','after','tool-history:0']);
  assert.equal(messages[1].role,'assistant');
  assert.equal(messages[1].images[0].src,'data:image/png;base64,iVBORw0KGgoAAAA=');
  assert.equal(messagesOf(state)[1].images,messages[1].images);
 }
});
test('generation waits for completion and can use saved paths or desktop src without inline pixels',()=>{
 assert.deepEqual(generatedImagesOf({id:'pending',status:'inProgress',savedPath:'C:/not-ready.png'}),[]);
 assert.deepEqual(generatedImagesOf({id:'failed',status:'failed',result:'bad'}),[]);
 assert.equal(generatedImagesOf({id:'file',status:'completed',result:'',savedPath:'C:/a.png'})[0].src,'C:/a.png');
 assert.equal(generatedImagesOf({id:'src',status:'completed',src:'/C:/a.png'})[0].src,'/C:/a.png');
 assert.deepEqual(generatedImagesOf({id:'empty',status:'completed',fileId:'attachment-id'}),[]);
});
