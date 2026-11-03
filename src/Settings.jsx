import React,{memo,useEffect,useRef,useState} from 'react';
import {Settings as SettingsIcon,Sun,Moon} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {readTheme} from './theme';
import {readAppearance,applyTransparency} from './appearance';

export const Settings=memo(function Settings(){
 const [open,setOpen]=useState(false),[theme,setTheme]=useState(()=>readTheme(localStorage));
 const [appearance,setAppearance]=useState(()=>readAppearance(localStorage));
 const [mode,setMode]=useState(window.__TAURI_INTERNALS__?'loading':'browser'),[blurError,setBlurError]=useState('');
 const root=useRef(null),button=useRef(null),themeButtons=useRef(null),appliedBlur=useRef(null);
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
   appliedBlur.current=settings.amount;
   setMode(settings.mode);
  }).catch(()=>{if(!cancelled)setMode('unavailable');});
  return ()=>{cancelled=true;};
 },[]);
 useEffect(()=>{
  if(mode!=='custom-blur'||appearance.blur===appliedBlur.current)return;
  let cancelled=false;
  const amount=appearance.blur;
  const timer=setTimeout(()=>{
   invoke('set_background_blur',{amount}).then(actual=>{
    appliedBlur.current=actual;
    if(!cancelled)setBlurError('');
   }).catch(error=>{
    if(cancelled)return;
    setBlurError('模糊程度未能应用：'+String(error));
    setAppearance(current=>({...current,blur:appliedBlur.current??10}));
   });
  },100);
  return ()=>{cancelled=true;clearTimeout(timer);};
 },[mode,appearance.blur]);
 useEffect(()=>{
  if(!open)return;
  themeButtons.current?.querySelector('[aria-pressed="true"]')?.focus();
  const pointer=e=>{if(!root.current?.contains(e.target))setOpen(false);};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',pointer);
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
 },[open]);
 return <div className="settings-control" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <button ref={button} type="button" className="icon-button caption-button settings-button" title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded={open} aria-controls={open?'appearance-settings':undefined} onClick={()=>setOpen(current=>!current)}><SettingsIcon size={16} aria-hidden="true"/></button>
  {open&&<div id="appearance-settings" className="settings-panel" role="dialog" aria-label="显示设置" onMouseDown={e=>e.stopPropagation()}>
   <strong>显示设置</strong>
   <div className="settings-theme"><span id="appearance-theme-label">主题</span><div ref={themeButtons} className="settings-theme-toggle" role="group" aria-labelledby="appearance-theme-label">
    <button type="button" className="theme-option" title="亮色主题" aria-label="亮色主题" aria-pressed={theme==='light'} onClick={()=>setTheme('light')}><Sun size={16} aria-hidden="true"/></button>
    <button type="button" className="theme-option" title="暗色主题" aria-label="暗色主题" aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')}><Moon size={16} aria-hidden="true"/></button>
   </div></div>
   <div className="settings-range"><label htmlFor="appearance-blur">背景模糊程度<output htmlFor="appearance-blur">{appearance.blur}</output></label><input id="appearance-blur" type="range" min="0" max="60" step="1" disabled={mode!=='custom-blur'} value={appearance.blur} onChange={e=>setAppearance(current=>({...current,blur:Number(e.target.value)}))}/><div className="settings-range-hint"><span>清晰</span><span>模糊</span></div></div>
   <div className="settings-range"><label htmlFor="appearance-transparency">背景透明度<output htmlFor="appearance-transparency">{appearance.transparency}%</output></label><input id="appearance-transparency" type="range" min="0" max="100" step="1" title="数值越低越透明" value={appearance.transparency} onChange={e=>setAppearance(current=>({...current,transparency:Number(e.target.value)}))}/><div className="settings-range-hint"><span>透明</span><span>不透明</span></div></div>
   {mode!=='custom-blur'&&mode!=='loading'&&<p className="settings-note">当前背景模式不支持调节模糊程度。</p>}
   {blurError&&<p className="settings-error" role="alert">{blurError}</p>}
  </div>}
 </div>;
});
