export function hasMessageEcho(remote, local) {
 return remote.some(message => message.role === 'user' && (
  message.id === local.id || message.clientMessageId === local.id ||
  (!local.baselineIds.has(message.id) && message.text.trim() === local.text)
 ));
}
export function unconfirmedMessages(remote, local) {
 const available=new Set(remote.map((message,index)=>message.role==='user'?index:null).filter(index=>index!==null));
 const matched=new Set();
 const match=(message,exact)=>{
  const index=[...available].find(index=>{
   const candidate=remote[index];
   return exact?candidate.id===message.id||candidate.clientMessageId===message.id:!message.baselineIds.has(candidate.id)&&candidate.text.trim()===message.text;
  });
  if(index!==undefined){available.delete(index);matched.add(message);}
 };
 for(const message of local)match(message,true);
 for(const message of local)if(!matched.has(message))match(message,false);
 return local.filter(message=>!matched.has(message));
}
export function mergeOptimisticMessages(remote, local) {
 return [...remote, ...unconfirmedMessages(remote, local)];
}
export function afterMessagePaint() {
 return new Promise(resolve => {
  // Still send when the panel is hidden and animation frames are suspended.
  const timeout = setTimeout(resolve, 80);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
 });
}
