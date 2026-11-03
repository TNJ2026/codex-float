import test from 'node:test';
import assert from 'node:assert/strict';
import {readTheme,nextTheme} from '../src/theme.js';

test('explicit light and dark preferences survive restart, and first use starts dark',()=>{
 assert.equal(readTheme({getItem:()=>null}),'dark');
 assert.equal(readTheme({getItem:()=>'dark'}),'dark');
 assert.equal(readTheme({getItem:()=>'light'}),'light');
 assert.equal(readTheme({getItem:()=>'invalid'}),'dark');
 assert.equal(readTheme({getItem:()=>{throw Error('storage blocked');}}),'dark');
 assert.equal(nextTheme('dark'),'light');
 assert.equal(nextTheme('light'),'dark');
});
