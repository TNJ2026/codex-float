import {turnsOf} from './model.js';
export function activeTurnId(state){
 const turn=turnsOf(state).findLast(entry=>entry.status==='inProgress');
 return turn?.turnId||turn?.id||null;
}
export function turnIsRunning(state,id){
 return turnsOf(state).some(entry=>(entry.turnId||entry.id)===id&&entry.status==='inProgress');
}
