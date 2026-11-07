import {t} from './i18n.js';
import {activityOf,turnsOf} from './model.js';
export function miniStatus(state,connection,pending=false){
 if(connection==='connecting')return {kind:'connecting',label:t("同步中")};
 if(connection!=='live'||!state)return {kind:'offline',label:t("未连接")};
 if(state.requests?.length)return {kind:'waiting',label:t("待确认")};
 if(pending||activityOf(state)||state.unconfirmedTurnSubmissions?.some(item=>!item.terminal))return {kind:'working',label:t("执行中")};
 const latest=turnsOf(state).at(-1);
 if(latest?.status==='failed'||latest?.error)return {kind:'failed',label:t("执行失败")};
 if(latest?.status==='interrupted')return {kind:'stopped',label:t("已停止")};
 if(latest?.status==='completed')return {kind:'completed',label:t("已完成")};
 return {kind:'idle',label:t("就绪")};
}
