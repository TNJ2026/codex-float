// Project identities, rather than names, keep equally named projects separate.
export function groupThreads(threads) {
 const groups=new Map();
 for(const thread of threads){
  const project=thread.project_id||null;
  const key=project?`project:${project}`:'unassigned';
  if(!groups.has(key))groups.set(key,{
   key,name:project?(thread.project_name||'未命名项目'):'未分配项目',
   unassigned:!project,
   order:Number.isFinite(thread.project_order)?thread.project_order:Number.MAX_SAFE_INTEGER,
   threads:[]
  });
  groups.get(key).threads.push(thread);
 }
 return [...groups.values()].sort((a,b)=>Number(a.unassigned)-Number(b.unassigned)||a.order-b.order);
}
