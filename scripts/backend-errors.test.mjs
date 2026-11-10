import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import english from '../src/locales/en.js';
import {setLanguage, t} from '../src/i18n.js';

test('backend errors translate without changing paths, diagnostics or conversation content', () => {
 setLanguage('en');
 try {
  assert.equal(t('请先连接聊天'), 'Connect a chat first');
  assert.equal(t('连接 Codex 超时'), 'Timed out connecting to Codex');
  assert.equal(t('Error: 连接 Codex 超时'), 'Error: Timed out connecting to Codex');
  assert.equal(t('无法连接 Codex，请先打开桌面端：access denied (5)'), 'Could not connect to Codex. Open the desktop app first: access denied (5)');
  assert.equal(t('查找聊天运行实例失败: Codex 管道已关闭'), 'Could not discover the chat owner: The Codex pipe closed');
  assert.equal(t('卡片请求失败：请先连接聊天'), 'The card request failed: Connect a chat first');
  const path='D:\\中文目录\\$&{1}.txt';
  assert.equal(t(`无法读取附件 ${path}：access denied`), `Could not read attachment ${path}: access denied`);
  assert.equal(t('用户写的原文，请先连接聊天'), '用户写的原文，请先连接聊天');
  assert.equal(t('unrecognized remote error'), 'unrecognized remote error');
  setLanguage('zh-CN');
  assert.equal(t('请先连接聊天'), '请先连接聊天');
  assert.equal(t('无法读取附件 中文.txt：access denied'), '无法读取附件 中文.txt：access denied');
 } finally { setLanguage('zh-CN'); }
});

test('application-owned Rust error literals have English catalog entries', () => {
 const root=new URL('../src-tauri/src/', import.meta.url);
 const missing=[];
 // Inspect error-producing expressions, rather than prompt or context content.
 const expressions=/(?:Err\s*\(\s*(?:format!\s*\(\s*)?|\.ok_or\s*\(\s*|\.map_err\s*\(\s*\|[^|]*\|\s*(?:format!\s*\(\s*)?)"((?:\\.|[^"\\])*)"/gu;
 for(const file of fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.rs'))){
  const source=fs.readFileSync(new URL(file.replaceAll('\\','/'), root),'utf8');
  for(const match of source.matchAll(expressions)){
   if(/[\u3400-\u9fff]/u.test(match[1])&&!Object.hasOwn(english,match[1]))missing.push(`${file}: ${match[1]}`);
  }
 }
 assert.deepEqual(missing,[],'Add translations for new backend errors');
});
