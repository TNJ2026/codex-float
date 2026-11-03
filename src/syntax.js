import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

const languages={javascript,typescript,python,rust,c,cpp,csharp,java,go,bash,powershell,json,yaml,xml,css,markdown,sql,diff,ini,dockerfile};
for(const [name,grammar] of Object.entries(languages))hljs.registerLanguage(name,grammar);
const aliases={js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',py:'python',rs:'rust',h:'c',cc:'cpp',cxx:'cpp',hpp:'cpp','c++':'cpp',cs:'csharp','c#':'csharp',sh:'bash',shell:'bash',zsh:'bash',ps:'powershell',ps1:'powershell',psm1:'powershell',jsonc:'json',yml:'yaml',html:'xml',htm:'xml',svg:'xml',xaml:'xml',csproj:'xml',props:'xml',targets:'xml',md:'markdown',mdx:'markdown',toml:'ini',cfg:'ini',conf:'ini',patch:'diff'};
const escapeCode=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export function codeLanguage(hint=''){
 const requested=String(hint).trim().split(/\s+/u)[0].toLowerCase();
 const name=Object.hasOwn(aliases,requested)?aliases[requested]:requested;
 return Object.hasOwn(languages,name)?name:'plaintext';
}
export function languageForFile(path=''){
 const name=path.replaceAll('\\','/').split('/').at(-1).toLowerCase();
 if(name==='dockerfile'||name.startsWith('dockerfile.'))return 'dockerfile';
 if(name==='.env'||name.startsWith('.env.'))return 'ini';
 return codeLanguage(name.includes('.')?name.split('.').at(-1):'');
}
export function highlightCode(text,hint=''){
 const language=codeLanguage(hint);
 // Bound synchronous grammar work while keeping large files readable and selectable.
 if(language==='plaintext'||text.length>100000||text.split('\n').some(line=>line.length>10000))return {language,html:escapeCode(text)};
 try{return {language,html:hljs.highlight(text,{language,ignoreIllegals:true}).value};}
 catch{return {language,html:escapeCode(text)};}
}
