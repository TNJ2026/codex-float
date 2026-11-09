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
  const click=element=>act(async()=>element.click()),trigger=()=>document.querySelector('[aria-label="切换响应速度"]');
  await render();assert.equal(trigger().getAttribute('aria-pressed'),'false');assert.equal(trigger().hasAttribute('aria-haspopup'),false);
  await click(trigger());await render();assert.equal(document.querySelector('[role="menu"]'),null);assert.ok(trigger().classList.contains('fast'));assert.equal(trigger().getAttribute('aria-pressed'),'true');assert.deepEqual(calls.find(call=>call.cmd==='update_speed_settings').args,{threadId:'one',model:'m',fast:true});assert.deepEqual(guards,[true,false]);
  reject=true;await click(trigger());assert.match(errors.at(-1),/not available/);assert.equal(trigger().getAttribute('aria-pressed'),'true');assert.equal(applied.length,1);
  reject=false;await click(trigger());await render();assert.equal(trigger().classList.contains('fast'),false);
  supported=false;await click(trigger());assert.match(errors.at(-1),/未提供快速模式/);assert.equal(document.querySelector('[role="menu"]'),null);
  const count=applied.length;toggleRequest++;await render();assert.equal(applied.length,count);assert.match(errors.at(-1),/未提供快速模式/);assert.equal(guards.at(-1),false);
  supported=true;toggleRequest++;await render();await render();assert.equal(tier,'fast');tier='priority';toggleRequest++;await render();await render();assert.equal(tier,'default');
  defer=true;await click(trigger());assert.equal(guards.at(-1),true);assert.equal(trigger().disabled,true);const before=applied.length,saveCount=calls.filter(call=>call.cmd==='update_speed_settings').length;await click(trigger());assert.equal(calls.filter(call=>call.cmd==='update_speed_settings').length,saveCount);threadId='two';await render();await act(async()=>finish({threadSettings:{serviceTier:'fast'}}));assert.equal(applied.length,before);assert.equal(guards.at(-1),false);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
