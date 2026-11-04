export function finalReplyCopies(messages){
 const last=new Map();
 for(const message of messages){
  if(message.type||message.role!=='assistant'||message.turnStatus!=='completed'||!message.turnId||!message.text?.trim()||message.pending||message.failed)continue;
  last.set(message.turnId,message);
 }
 const selected=new Set(last.values());
 return messages.map(message=>({...message,copyable:selected.has(message)}));
}
