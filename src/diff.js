export function diffLines(text,kind='update'){
 const lines=text.split(/\r?\n/u);
 if(lines.at(-1)==='')lines.pop();
 if(kind==='add'||kind==='delete')return lines.map((text,index)=>({type:kind,text,oldLine:kind==='delete'?index+1:null,newLine:kind==='add'?index+1:null}));
 let oldLine=0,newLine=0,inHunk=false;
 return lines.map(text=>{
  const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text);
  if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);inHunk=true;return {type:'hunk',text};}
  if(text.startsWith('diff --git ')){inHunk=false;return {type:'meta',text};}
  if(!inHunk||text.startsWith('\\'))return {type:'meta',text};
  if(text.startsWith('+'))return {type:'add',text:text.slice(1),oldLine:null,newLine:newLine++};
  if(text.startsWith('-'))return {type:'delete',text:text.slice(1),oldLine:oldLine++,newLine:null};
  if(text.startsWith(' '))return {type:'context',text:text.slice(1),oldLine:oldLine++,newLine:newLine++};
  return {type:'meta',text};
 });
}
