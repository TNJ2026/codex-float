import {activeTurnsOf} from './model.js';
export function activeTurnId(state){
 const turn=activeTurnsOf(state).at(-1);
 return turn?.turnId||turn?.id||null;
}
export function turnIsRunning(state,id){
 return activeTurnsOf(state).some(entry=>(entry.turnId||entry.id)===id);
}
