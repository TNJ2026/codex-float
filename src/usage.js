import {t} from './i18n.js';
export function quotaWindows(data) {
 const buckets=data?.rateLimitsByLimitId;
 const limits=buckets&&Object.keys(buckets).length?Object.entries(buckets):data?.rateLimits?[['codex',data.rateLimits]]:[];
 return limits.flatMap(([id,limit])=>['primary','secondary'].flatMap(slot=>{
  const window=limit?.[slot];
  if(!window||!Number.isFinite(window.usedPercent))return [];
  const minutes=window.windowDurationMins;
  const label=minutes===10080?t("每周"):Number.isFinite(minutes)&&minutes>0?minutes%60===0?t("{0}小时",[minutes/60]):t("{0}分钟",[minutes]):slot==='primary'?t("短期"):t("长期");
  return [{id:`${id}-${slot}`,bucket:limit.limitName||id,label,windowMinutes:minutes,remaining:Math.max(0,Math.min(100,100-window.usedPercent)),resetsAt:Number.isFinite(window.resetsAt)?window.resetsAt:null}];
 }));
}
export function ringQuota(windows) {
 return windows.find(w=>w.id==='codex-primary'&&w.windowMinutes===300) || windows.find(w=>w.windowMinutes===300)
  || windows.find(w=>w.id==='codex-secondary'&&w.windowMinutes===10080) || windows.find(w=>w.windowMinutes===10080) || null;
}
