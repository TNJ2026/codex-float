import {t} from './i18n.js';
import {turnsOf} from './model.js';
const OPEN='<send_user_message_question_reply>',CLOSE='</send_user_message_question_reply>';
const itemsOf=turn=>Array.isArray(turn.items)?turn.items:Object.values(turn.items?.entitiesByKey||{});
export function parseQuestionReply(text){
 const start=text.lastIndexOf(OPEN),end=text.lastIndexOf(CLOSE);
 if(start<0||end<start)return [];
 try{const parsed=JSON.parse(text.slice(start+OPEN.length,end).trim());return (Array.isArray(parsed)?parsed:[parsed]).filter(r=>typeof r?.questionItemId==='string'&&typeof r.question==='string'&&typeof r.answer==='string');}catch{return [];}
}
export function asyncQuestionRequests(state){
 const turns=turnsOf(state);
 // The model can finish while its async question dialog remains open. Keep the
 // latest question batch addressable across subsequent turns, until answered.
 const turn=turns.findLast(entry=>itemsOf(entry).some(i=>i.type==='agentMessage'&&i.questions?.length));
 if(!turn)return [];
 const items=itemsOf(turn),answered=new Set();
 for(const item of turns.flatMap(itemsOf)){
  if(item.type!=='userMessage'&&!(item.type==='steeringUserMessage'&&item.status==='accepted'))continue;
  const text=(item.content||item.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  for(const reply of parseQuestionReply(text))answered.add(reply.questionItemId);
 }
 return items.filter(i=>i.type==='agentMessage'&&Array.isArray(i.questions)).flatMap(item=>{
  const questions=item.questions.map((q,index)=>({id:JSON.stringify(['request_user_input_async',item.id,index]),question:q.title,options:(q.options||[]).map(o=>typeof o==='string'?{label:o}:o),isOther:true})).filter(q=>typeof q.question==='string'&&!answered.has(q.id));
  return questions.length?[{id:`async:${item.id}`,method:'local/asyncQuestions',params:{questions}}]:[];
 });
}
export function questionReplyText(request,response){
 return OPEN+'\n'+JSON.stringify(request.params.questions.map(q=>{
  const answer=response?.answers?.[q.id]?.answers?.[0];
  if(typeof answer!=='string'||!answer.trim())throw Error(t("请回答所有问题"));
  return {questionItemId:q.id,question:q.question,answer};
 }))+'\n'+CLOSE;
}
