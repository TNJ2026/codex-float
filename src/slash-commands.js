import {t} from './i18n.js';
export const slashCommands=[
 {id:'model',title:'模型与推理强度',description:'选择模型和推理强度'},
 {id:'fast',title:'切换快速模式',description:'切换标准与快速响应，下轮生效'},
 {id:'permissions',title:'权限',description:'设置只读、默认权限或完全访问'},
 {id:'skills',title:'技能',description:'浏览并添加可用技能'},
 {id:'mention',title:'添加上下文',description:'搜索文件、目录、网页和其他对话'},
 {id:'plan',title:'计划模式',description:'切换为先制定计划，下轮生效'},
 {id:'agent',title:'执行模式',description:'切换回默认执行模式，下轮生效'},
 {id:'compact',title:'压缩上下文',description:'压缩当前聊天的上下文，保留摘要',idleOnly:true},
 {id:'status',title:'聊天状态',description:'查看当前聊天的模型、权限和工作目录'},
];
export function slashAt(text,caret=text.length){
 const prefix=text.slice(0,caret),match=/^\s*\/([^\n\r/]*)$/u.exec(prefix);
 return match?{start:0,end:caret,text:prefix,query:match[1]}:null;
}
export function slashRows(query,skills,busy){
 const words=query.trim().toLocaleLowerCase().split(/\s+/u);
 const matches=row=>words.every(word=>[row.id,row.title,row.description,t(row.title),t(row.description)].join(' ').toLocaleLowerCase().includes(word));
 return [...slashCommands.map(command=>({...command,kind:'command',disabled:!!command.idleOnly&&busy})),...skills.map(skill=>({id:skill.label,title:skill.label,description:skill.description||skill.path,kind:'skill',skill}))].filter(matches).slice(0,80);
}
