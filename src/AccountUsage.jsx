import {t,useLanguage,getLanguage} from './i18n.js';
import React,{cloneElement,memo,useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {quotaWindows,ringQuota} from './usage';

export const AccountUsage=memo(function AccountUsage({busy,children}){
 useLanguage();
 const [windows,setWindows]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [updatedAt,setUpdatedAt]=useState(null);
 const active=useRef(false),mounted=useRef(false),lastRequest=useRef(0);
 const refresh=useCallback(async(force=false)=>{
  if(active.current||!window.__TAURI_INTERNALS__||(!force&&Date.now()-lastRequest.current<15000))return;
  lastRequest.current=Date.now();
  active.current=true;setLoading(true);
  try{
   const result=quotaWindows(await invoke('read_usage'));
   if(mounted.current){setWindows(result);setUpdatedAt(Date.now());setError(result.length?'':t("暂无账号额度信息"));}
  }catch(e){if(mounted.current)setError(String(e));}
  finally{active.current=false;if(mounted.current)setLoading(false);}
 },[]);
 useEffect(()=>{
  mounted.current=true;refresh();
  const wake=()=>{if(!document.hidden)refresh();};
  const timer=setInterval(wake,30000);
  window.addEventListener('focus',wake);
  document.addEventListener('visibilitychange',wake);
  return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};
 },[refresh]);
 const wasBusy=useRef(busy);
 useEffect(()=>{if(wasBusy.current&&!busy)refresh(true);wasBusy.current=busy;},[busy,refresh]);
 useEffect(()=>{
  const next=windows.map(w=>w.resetsAt*1000).filter(time=>time>Date.now()).sort((a,b)=>a-b)[0];
  if(!next)return;
  const timer=setTimeout(()=>refresh(true),next-Date.now()+1000);
  return()=>clearTimeout(timer);
 },[windows,refresh]);
 const quota=ringQuota(windows);
 const remaining=quota?.remaining;
 const label=quota?t("{0}剩余 {1}%",[quota.label,Math.round(remaining)]):loading?t("正在读取额度"):t("额度暂不可用");
 const title=[label,quota?.resetsAt&&t("重置于 {0}",[new Date(quota.resetsAt*1000).toLocaleString(getLanguage())]),updatedAt&&t("更新时间：{0}",[new Date(updatedAt).toLocaleTimeString(getLanguage())]),error&&t("读取失败，数据未更新：{0}",[error]),t("每30秒自动更新")].filter(Boolean).join('\n');
 const tone=remaining==null?'unknown':remaining<=5?'critical':remaining<=20?'warning':'normal';
 return <div className={'send-quota '+tone} title={title}>
  <div className="quota-ring" role="img" aria-label={label} aria-busy={loading}>
   <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle className="quota-track" cx="12" cy="12" r="11" fill="none" strokeWidth="1.5"/>
    {quota&&remaining>0&&<circle className="quota-arc" cx="12" cy="12" r="11" fill="none" strokeWidth="1.5" pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 12 12)"/>}
   </svg>
  </div>
  {cloneElement(children,{title:`${children.props.title}\n${title}`})}
 </div>;
});
