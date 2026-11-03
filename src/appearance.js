export const DEFAULT_APPEARANCE=Object.freeze({blur:10,transparency:60});
const number=(value,fallback,max)=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(0,Math.min(max,value))):fallback;
export function normalizeAppearance(value={}){
 return {blur:number(value?.blur,10,60),transparency:number(value?.transparency,60,100)};
}
export function readAppearance(storage){
 try{return normalizeAppearance(JSON.parse(storage.getItem('codex-float-appearance')||'{}'));}
 catch{return {...DEFAULT_APPEARANCE};}
}
export function applyTransparency(root,transparency){
 const value=number(transparency,60,100);
 root.style.setProperty('--background-alpha',String(value/100));
}
