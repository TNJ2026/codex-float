import React,{memo,useMemo} from 'react';
import DOMPurify from 'dompurify';
import {highlightCode,languageForFile} from './syntax';

const purifier=DOMPurify(window);
export const CodePreview=memo(function CodePreview({text,filename}){
 const code=useMemo(()=>{
  const result=highlightCode(text,languageForFile(filename));
  return {...result,html:purifier.sanitize(result.html,{ALLOWED_TAGS:['span'],ALLOWED_ATTR:['class']})};
 },[text,filename]);
 return <pre><code className={`syntax-code language-${code.language}`} dangerouslySetInnerHTML={{__html:code.html}}/></pre>;
});
