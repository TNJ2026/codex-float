import { useSyncExternalStore } from 'react';
import english from './locales/en.js';
import backendErrors from './locales/backend-en.js';

const storageKey = 'codex-float-language';
const listeners = new Set();
const chinese = Object.fromEntries(Object.entries(english).map(([zh, en]) => [en, zh]));
export function readLanguage(storage) {
  try {
    return storage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}
let language = 'zh-CN';
try {
  language = readLanguage(globalThis.localStorage);
} catch {}

export const getLanguage = () => language;
export function setLanguage(value) {
  const next = value === 'en' ? 'en' : 'zh-CN';
  language = next;
  try {
    globalThis.localStorage.setItem(storageKey, next);
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

const errorTemplates = Object.entries(backendErrors)
  .flatMap(([source, translation]) => {
    const slots = [...source.matchAll(/\{(\w*)\}/gu)];
    if (!slots.length) return [];
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    let offset = 0,
      pattern = '^';
    for (const slot of slots) {
      pattern += escape(source.slice(offset, slot.index)) + '([\\s\\S]+?)';
      offset = slot.index + slot[0].length;
    }
    return [
      {
        source,
        translation,
        slots,
        pattern: new RegExp(pattern + escape(source.slice(offset)) + '$', 'u'),
      },
    ];
  })
  .sort((a, b) => b.source.length - a.source.length);

function englishMessage(message, depth = 0) {
  const exact = english[chinese[message] ?? message];
  if (exact) return exact;
  if (depth >= 4) return message;
  if (message.startsWith('Error: ')) return 'Error: ' + englishMessage(message.slice(7), depth + 1);
  for (const { translation, slots, pattern } of errorTemplates) {
    const match = pattern.exec(message);
    if (!match) continue;
    let index = 0;
    // A replacement callback preserves literal dollars and braces in diagnostics.
    return translation.replace(/\{\w*\}/gu, () => {
      const name = slots[index][1],
        value = match[++index];
      return ['', 'error', 'e'].includes(name) ? englishMessage(value, depth + 1) : value;
    });
  }
  const separator = /[:：]\s*/u.exec(message);
  if (separator) {
    const prefix = message.slice(0, separator.index),
      suffix = message.slice(separator.index + separator[0].length);
    const translated = english[chinese[prefix] ?? prefix] ?? english[prefix + separator[0]];
    if (translated)
      return translated.replace(/[:：]\s*$/u, '') + ': ' + englishMessage(suffix, depth + 1);
  }
  return message;
}

export function t(message, values = []) {
  if (typeof message !== 'string') return message;
  const source = chinese[message] ?? message;
  const translated = language === 'en' ? englishMessage(source) : source;
  return translated.replace(/\{(\d+)\}/gu, (token, index) =>
    values[index] === undefined ? token : String(values[index]),
  );
}
