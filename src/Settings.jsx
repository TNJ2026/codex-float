import React,{memo,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Sun,Moon,X} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {readTheme} from './theme';
import {readAppearance,applyTransparency} from './appearance';
import {useSettingsGlass} from './useSettingsGlass';

export const Settings=memo(function Settings({predictionsEnabled=false,onPredictionsChange,nativeToolbar=false,openRequest=0,available=true}){
 const [open,setOpen]=useState(false),[theme,setTheme]=useState(()=>readTheme(localStorage));
 const [appearance,setAppearance]=useState(()=>readAppearance(localStorage));
 const [mode,setMode]=useState(window.__TAURI_INTERNALS__?'loading':'browser');
 const root=useRef(null),button=useRef(null),themeButtons=useRef(null);
 const panel=useRef(null),nativeGlass=useSettingsGlass(panel,open&&available,mode);
 const Panel=nativeToolbar?'dialog':'div';
 useLayoutEffect(()=>{
  if(!nativeToolbar||!open||!available)return;
  const element=panel.current;
  element.showModal();
  return ()=>element.close();
 },[nativeToolbar,open,available]);
 const nativeSwitch='switch' in window.HTMLInputElement.prototype;
 useEffect(()=>{if(openRequest&&available)setOpen(true);},[openRequest]);
 useEffect(()=>{if(!available)setOpen(false);},[available]);
 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('codex-float-theme',theme);}catch{}
  if(window.__TAURI_INTERNALS__)getCurrentWindow().setTheme(theme).catch(()=>{});
 },[theme]);
 useEffect(()=>{
  applyTransparency(document.documentElement,appearance.transparency);
  try{localStorage.setItem('codex-float-appearance',JSON.stringify(appearance));}catch{}
 },[appearance]);
 useEffect(()=>{
  if(!window.__TAURI_INTERNALS__)return;
  let cancelled=false;
  invoke('background_settings').then(settings=>{
   if(cancelled)return;
   document.documentElement.dataset.nativeBackground=settings.mode;
   setMode(settings.mode);
  }).catch(()=>{if(!cancelled)setMode('unavailable');});
  return ()=>{cancelled=true;};
 },[]);
 useEffect(()=>{
  if(!open)return;
  themeButtons.current?.querySelector('[aria-pressed="true"]')?.focus();
  const pointer=e=>{
   const element=panel.current;
   if(nativeToolbar&&e.target===element&&e.type==='pointerdown'){
    const bounds=element.getBoundingClientRect();
    if(e.clientX<bounds.left||e.clientX>=bounds.right||e.clientY<bounds.top||e.clientY>=bounds.bottom)setOpen(false);
   }else if(!root.current?.contains(e.target))setOpen(false);
  };
  let tabbing=false;
  const key=e=>{tabbing=e.key==='Tab';if(e.key==='Escape'){e.preventDefault();setOpen(false);button.current?.focus();}};
  // AppKit restores the previous WebKit focus after native menus and sheets.
  // Only a user's Tab navigation should dismiss on an outside focus event.
  const focus=e=>{if(tabbing)pointer(e);tabbing=false;};
  document.addEventListener('pointerdown',pointer);
  document.addEventListener('focusin',focus);
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('focusin',focus);document.removeEventListener('keydown',key);};
 },[open]);
 return <div className="settings-control" data-native-toolbar={nativeToolbar||undefined} ref={root}>
  <button ref={button} hidden={nativeToolbar} type="button" className="icon-button caption-button settings-button" title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded={open} aria-controls={open?'appearance-settings':undefined} onClick={()=>setOpen(current=>!current)}><span className="settings-icon" aria-hidden="true"/></button>
  {open&&available&&<Panel ref={panel} id="appearance-settings" className="settings-panel" data-native-glass={nativeGlass||undefined} role="dialog" aria-label="显示设置" onCancel={e=>{e.preventDefault();setOpen(false);}} onMouseDown={e=>e.stopPropagation()}>
   <div className="settings-heading"><strong>显示设置</strong><button type="button" className="settings-close" title="关闭设置" aria-label="关闭设置" onClick={()=>{setOpen(false);if(!nativeToolbar)button.current?.focus();}}><X size={14} aria-hidden="true"/></button></div>
   <div className="settings-theme"><span id="appearance-theme-label">主题</span><div ref={themeButtons} className="settings-theme-toggle" role="group" aria-labelledby="appearance-theme-label">
    <button type="button" className="theme-option" title="亮色主题" aria-label="亮色主题" aria-pressed={theme==='light'} onClick={()=>setTheme('light')}><Sun size={16} aria-hidden="true"/></button>
    <button type="button" className="theme-option" title="暗色主题" aria-label="暗色主题" aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')}><Moon size={16} aria-hidden="true"/></button>
   </div></div>
   <div className="settings-range"><label htmlFor="appearance-transparency">背景透明度<output htmlFor="appearance-transparency">{appearance.transparency}%</output></label><input id="appearance-transparency" type="range" min="0" max="100" step="1" title="数值越低越透明" value={appearance.transparency} onChange={e=>setAppearance(current=>({...current,transparency:Number(e.target.value)}))}/><div className="settings-range-hint"><span>透明</span><span>不透明</span></div></div>
   {mode==='liquid-glass'&&<p className="settings-note">当前使用 macOS 原生 Liquid Glass（清透）。</p>}
   <label className="settings-predictions"><span>输入预测</span><input type="checkbox" role="switch" switch={nativeSwitch?'':undefined} checked={predictionsEnabled} onChange={e=>onPredictionsChange?.(e.target.checked)}/></label>
   <p className="settings-note">独立预测使用当前模型，额外消耗模型额度。建议仅填入草稿，不自动发送。</p>
  </Panel>}
 </div>;
});
