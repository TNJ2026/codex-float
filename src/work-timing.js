const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function turnDurationMs(turn){
 if(valid(turn?.durationMs))return turn.durationMs;
 // The app-server protocol defines startedAt/completedAt as Unix seconds.
 if(valid(turn?.startedAt)&&valid(turn?.completedAt)&&turn.completedAt>=turn.startedAt)return (turn.completedAt-turn.startedAt)*1000;
 return null;
}
export function workDurationLabel(milliseconds){
 if(!valid(milliseconds))return '未提供';
 const seconds=Math.round(milliseconds/100)/10,hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=Math.round(seconds%60*10)/10;
 return [hours?`${hours} 小时`:null,minutes?`${minutes} 分`:null,`${rest} 秒`].filter(Boolean).join(' ');
}
