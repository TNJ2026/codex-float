import {turnsOf} from './model.js';
export function activeTurnId(state){
 const turn=turnsOf(state).findLast(t=>t.status==='inProgress');
 return turn?.turnId||turn?.id||null;
}
export function turnIsRunning(state,id){
 return turnsOf(state).some(t=>(t.turnId||t.id)===id&&t.status==='inProgress');
}
