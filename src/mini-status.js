import {activityOf,turnsOf} from './model.js';
export function miniStatus(state,connection,pending=false){
 if(connection==='connecting')return {kind:'connecting',label:'同步中'};
 if(connection!=='live'||!state)return {kind:'offline',label:'未连接'};
 if(state.requests?.length)return {kind:'waiting',label:'待确认'};
 if(pending||activityOf(state)||state.unconfirmedTurnSubmissions?.some(item=>!item.terminal))return {kind:'working',label:'执行中'};
 const latest=turnsOf(state).at(-1);
 if(latest?.status==='failed'||latest?.error)return {kind:'failed',label:'执行失败'};
 if(latest?.status==='interrupted')return {kind:'stopped',label:'已停止'};
 if(latest?.status==='completed')return {kind:'completed',label:'已完成'};
 return {kind:'idle',label:'就绪'};
}
