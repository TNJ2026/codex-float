import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {fastTier,isFast,effectiveTier,speedLabel} from '../src/speed-settings.js';

test('speed metadata recognizes fast and priority without opting into ultrafast',()=>{
 assert.equal(fastTier({serviceTiers:[{id:'priority',name:'Fast'}]}),'priority');
 assert.equal(fastTier({serviceTiers:[{id:'fast',name:'Fast'}]}),'fast');
 assert.equal(fastTier({additionalSpeedTiers:['fast']}),'fast');
 assert.equal(fastTier({serviceTiers:[{id:'ultrafast',name:'Ultrafast'}]}),null);
 assert.equal(isFast('priority'),true);assert.equal(isFast('fast'),true);assert.equal(isFast('ultrafast'),false);
 assert.equal(effectiveTier(null,{defaultServiceTier:'fast'}),'fast');assert.equal(effectiveTier('default',{defaultServiceTier:'fast'}),'default');assert.equal(speedLabel('fast'),'快速模式');
});

test('speed picker saves selections, rolls back failures, toggles through slash requests and ignores stale chat responses',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 document.documentElement.dataset.windowPlatform='windows';
 let threadId='one',tier='default',supported=true,reject=false,defer=false,finish,toggleRequest=0,model='m';
 const calls=[],applied=[],guards=[],errors=[];
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{calls.push({cmd,args});if(cmd==='read_model_options')return {settings:{model},models:[{model,serviceTiers:supported?[{id:'fast',name:'Fast'}]:[]}]};if(cmd==='update_speed_settings'){if(reject)throw 'not available';if(defer)return new Promise(resolve=>{finish=resolve;});return {threadSettings:{serviceTier:args.fast?'fast':'default'}};}throw Error(cmd);}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{
  const {createRoot}=await import('react-dom/client'),{SpeedPicker}=await vite.ssrLoadModule('/src/SpeedPicker.jsx');root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(SpeedPicker,{threadId,model,tier,toggleRequest,onSavingChange:value=>guards.push(value),onError:error=>errors.push(error),onApplied:(id,settings)=>{applied.push({id,settings});tier=settings.serviceTier;}})));
  const click=element=>act(async()=>element.click()),trigger=()=>document.querySelector('[aria-label="切换响应速度"]'),option=label=>[...document.querySelectorAll('[role="menuitemradio"]')].find(row=>row.textContent.startsWith(label));
  await render();await click(trigger());assert.equal(option('快速模式').disabled,false);assert.equal(option('标准速度').getAttribute('aria-checked'),'true');
  await click(option('快速模式'));await render();assert.equal(document.querySelector('[role="menu"]'),null);assert.ok(trigger().classList.contains('fast'));assert.deepEqual(calls.find(call=>call.cmd==='update_speed_settings').args,{threadId:'one',model:'m',fast:true});assert.deepEqual(guards,[true,false]);
  await click(trigger());reject=true;await click(option('标准速度'));assert.match(document.querySelector('[role="alert"]').textContent,/not available/);assert.equal(option('快速模式').getAttribute('aria-checked'),'true');assert.equal(applied.length,1);
  reject=false;await click(option('标准速度'));await render();assert.equal(trigger().classList.contains('fast'),false);
  supported=false;await click(trigger());assert.equal(option('快速模式').disabled,true);await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  const count=applied.length;toggleRequest++;await render();assert.equal(applied.length,count);assert.match(errors.at(-1),/未提供快速模式/);assert.equal(guards.at(-1),false);
  supported=true;toggleRequest++;await render();await render();assert.equal(tier,'fast');tier='priority';toggleRequest++;await render();await render();assert.equal(tier,'default');
  defer=true;toggleRequest++;await render();assert.equal(guards.at(-1),true);const before=applied.length;threadId='two';await render();await act(async()=>finish({threadSettings:{serviceTier:'fast'}}));assert.equal(applied.length,before);assert.equal(guards.at(-1),false);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
