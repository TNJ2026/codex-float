import {t} from './i18n.js';
export const interactionMethods={
 command:'item/commandExecution/requestApproval',file:'item/fileChange/requestApproval',
 permissions:'item/permissions/requestApproval',questions:'item/tool/requestUserInput',form:'mcpServer/elicitation/request'
};
const labels={accept:'允许一次',acceptForSession:'本次会话允许',decline:'拒绝',cancel:'拒绝并停止'};
export function formFields(schema){
 if(schema?.type!=='object'||!schema.properties||typeof schema.properties!=='object')return null;
 const fields=[];
 for(const [id,s] of Object.entries(schema.properties)){
  if(!s||!['string','number','integer','boolean','array'].includes(s.type)||s.$ref||s.anyOf||s.allOf)return null;
  const choices=s.type==='array'?s.items:s;
  const options=Array.isArray(choices?.enum)?choices.enum.map((value,i)=>({value,label:choices.enumNames?.[i]||String(value)})):
   Array.isArray(choices?.oneOf||choices?.anyOf)?(choices.oneOf||choices.anyOf).map(option=>({value:option.const,label:option.title||String(option.const)})):null;
  if(s.type==='array'&&!options)return null;
  if(options?.some(option=>typeof option.value!=='string'))return null;
  if(s.format&&!['email','uri','date','date-time'].includes(s.format))return null;
  const allowed=['type','title','description','default','enum','enumNames','oneOf','items','minItems','maxItems','minLength','maxLength','minimum','maximum','format'];
  if(Object.keys(s).some(key=>!allowed.includes(key)))return null;
  fields.push({...s,id,label:s.title||id,required:schema.required?.includes(id)||false,options});
 }
 return fields;
}
export function describeInteraction(request){
 const p=request.params||{},kind=Object.keys(interactionMethods).find(key=>interactionMethods[key]===request.method)||'unsupported';
 const base={kind,request,title:t("需要你确认"),body:p.reason||p.message||p.description||'',details:null};
 if(kind==='command'||kind==='file'){
  const decisions=(Array.isArray(p.availableDecisions)?p.availableDecisions:['accept','decline','cancel']).filter(value=>typeof value==='string'&&labels[value]).map(value=>({value,label:labels[value]}));
  if(!decisions.length||(kind==='file'&&!request.fileChanges))return {...base,kind:'unsupported',title:kind==='file'?t("需要查看文件修改并确认"):t("需要在主窗口完成审批")};
  return {...base,title:kind==='command'?t("是否允许执行这个命令？"):t("是否允许这些文件修改？"),
   details:{...(p.command?{命令:p.command}:p.commandActions?{命令:p.commandActions}:{}),...(p.cwd?{工作目录:p.cwd}:{}),...(p.grantRoot?{授权目录:p.grantRoot}:{}),...(request.fileChanges?{文件修改:request.fileChanges}:{}),...(p.additionalPermissions?{附加权限:p.additionalPermissions}:{}),...(p.networkApprovalContext?{网络访问:p.networkApprovalContext}:{})},
   decisions};
 }
 if(kind==='permissions')return {...base,title:t("是否授予这些权限？"),details:p.permissions||{},decisions:[{value:'accept',label:t("仅本轮允许")},{value:'decline',label:t("拒绝")}]};
 if(kind==='questions'||request.method==='local/asyncQuestions'){
  const questions=Array.isArray(p.questions)?p.questions:[];
  if(!questions.length||questions.some(q=>typeof q.id!=='string'||typeof q.question!=='string'))return {...base,kind:'unsupported'};
  return {...base,kind:'questions',title:t("请回答以下问题"),questions};
 }
 if(kind==='form'){
  const fields=['form','openai/form','openaiForm'].includes(p.mode)?formFields(p.requestedSchema):null;
  return fields?{...base,title:p.serverName?t("{0} 需要你填写信息",[p.serverName]):t("请填写以下信息"),fields}:
   {...base,kind:'unsupported',title:p.mode==='url'?t("需要登录或网页授权"):p.mode==='openai/userVerification'?t("需要系统身份验证"):t("需要在主窗口完成此操作")};
 }
 return {...base,kind:'unsupported',title:t("需要在主窗口完成此操作")};
}
export function initialValues(card){
 if(card.kind==='form')return Object.fromEntries(card.fields.filter(f=>f.default!==undefined&&f.default!==null).map(f=>[f.id,f.default]));
 return {};
}
export function buildInteractionReply(card,values={},decision){
 if(card.kind==='command'||card.kind==='file'){
  if(!card.decisions.some(d=>d.value===decision))throw Error(t("请选择当前请求允许的操作"));
  return {payload:{decision},summary:labels[decision]};
 }
 if(card.kind==='permissions'){
  if(!['accept','decline'].includes(decision))throw Error(t("请选择允许或拒绝"));
  return {payload:{response:{permissions:decision==='accept'?card.request.params.permissions:{},scope:'turn'}},summary:decision==='accept'?t("仅本轮允许这些权限"):t("拒绝授予权限")};
 }
 if(card.kind==='questions'){
  const answers={},summary=[];
  for(const q of card.questions){
   const value=String(values[q.id]??'').trim();
   if(!value)throw Error(t("请回答所有问题后提交"));
   if(q.options?.length&&!q.isOther&&!q.options.some(o=>o.label===value))throw Error(t("请选择问题提供的选项"));
   Object.defineProperty(answers,q.id,{value:{answers:[value]},enumerable:true});
   summary.push(`${q.header||q.question}：${q.isSecret?t("[已填写]"):value}`);
  }
  return {payload:{response:{answers}},summary:summary.join('\n')};
 }
 if(card.kind==='form'){
  if(['decline','cancel'].includes(decision))return {payload:{response:{action:decision,content:null}},summary:decision==='decline'?t("拒绝填写"):t("取消填写")};
  const content={},summary=[];
  for(const f of card.fields){
   let value=values[f.id];
   if(value===undefined||value===null||value===''){
    if(f.required)throw Error(t("请填写“{0}”",[f.label]));
    continue;
   }
   if(f.type==='number'||f.type==='integer'){
    value=Number(value);
    if(!Number.isFinite(value)||(f.type==='integer'&&!Number.isInteger(value))||(f.minimum!=null&&value<f.minimum)||(f.maximum!=null&&value>f.maximum))throw Error(t("“{0}”的数字不符合要求",[f.label]));
   }else if(f.type==='boolean'){
    if(typeof value!=='boolean')throw Error(t("请选择“{0}”",[f.label]));
   }else if(f.type==='array'){
    if(!Array.isArray(value)||value.some(v=>!f.options.some(o=>o.value===v))||(f.minItems!=null&&value.length<f.minItems)||(f.maxItems!=null&&value.length>f.maxItems))throw Error(t("“{0}”的选择数量不符合要求",[f.label]));
   }else{
    value=String(value);
    if((f.minLength!=null&&value.length<f.minLength)||(f.maxLength!=null&&value.length>f.maxLength)||(f.options&&!f.options.some(o=>o.value===value)))throw Error(t("“{0}”的内容不符合要求",[f.label]));
    if(f.format==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error(t("请填写有效的邮箱地址",[]));
    if(f.format==='uri'){try{new URL(value);}catch{throw Error(t("请填写有效的网址"));}}
    if(['date','date-time'].includes(f.format)&&Number.isNaN(Date.parse(value)))throw Error(t("请填写有效的日期"));
   }
   Object.defineProperty(content,f.id,{value,enumerable:true});
   summary.push(`${f.label}：${Array.isArray(value)?value.join('、'):typeof value==='boolean'?value?t("是"):t("否"):value}`);
  }
  return {payload:{response:{action:'accept',content}},summary:summary.join('\n')||t("确认继续")};
 }
 throw Error(t("请在 Codex 主窗口完成此操作"));
}
