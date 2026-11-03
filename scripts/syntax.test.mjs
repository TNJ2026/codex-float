import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {codeLanguage,highlightCode,languageForFile} from '../src/syntax.js';

test('fence aliases and file extensions select the correct grammar',()=>{
 for(const [hint,expected] of [['js','javascript'],['TS title=app.ts','typescript'],['c#','csharp'],['c++','cpp'],['ps1','powershell'],['toml','ini'],['html','xml']])assert.equal(codeLanguage(hint),expected);
 for(const [path,expected] of [['D:\\src\\main.rs','rust'],['app.tsx','typescript'],['README.md','markdown'],['config.JSON','json'],['.env.local','ini'],['Dockerfile','dockerfile'],['unknown.xyz','plaintext'],['notes.txt','plaintext']])assert.equal(languageForFile(path),expected);
 for(const hint of ['constructor','__proto__','js" onmouseover="alert(1)','not-a-language'])assert.equal(codeLanguage(hint),'plaintext');
});
test('highlighted code keeps its exact text and never creates active markup',()=>{
 const source='const value = "<img src=x onerror=alert(1)>";\n// 中文注释\nconsole.log(value);';
 const {html,language}=highlightCode(source,'js');
 const doc=new JSDOM(`<code>${html}</code>`).window.document;
 assert.equal(language,'javascript');
 assert.ok(doc.querySelector('.hljs-keyword'));
 assert.ok(doc.querySelector('.hljs-string'));
 assert.ok(doc.querySelector('.hljs-comment'));
 assert.equal(doc.querySelector('code').textContent,source);
 assert.equal(doc.querySelector('img,script,[onerror]'),null);
});
test('unknown languages and large files retain readable escaped text without grammar work',()=>{
 for(const [source,hint] of [['<script>alert(1)</script>','unknown'],['const text = "'+ 'x'.repeat(100001)+'";','js'],['x'.repeat(10001),'rust']]){
  const {html}=highlightCode(source,hint);
  const doc=new JSDOM(`<code>${html}</code>`).window.document;
  assert.equal(doc.querySelector('code').textContent,source);
  assert.equal(doc.querySelector('script,span'),null);
 }
});
