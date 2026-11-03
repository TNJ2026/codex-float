import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppearance,normalizeAppearance,applyTransparency} from '../src/appearance.js';

test('appearance settings restore saved numbers and recover safely from malformed preferences',()=>{
 const stored=value=>({getItem:()=>value});
 assert.deepEqual(readAppearance(stored(null)),{blur:10,transparency:60});
 assert.deepEqual(readAppearance(stored('{"blur":22,"transparency":65}')),{blur:22,transparency:65});
 for(const value of ['{broken','null','{"blur":"bad","transparency":null}'])assert.deepEqual(readAppearance(stored(value)),{blur:10,transparency:60});
 assert.deepEqual(readAppearance({getItem:()=>{throw Error('blocked');}}),{blur:10,transparency:60});
 assert.deepEqual(normalizeAppearance({blur:100,transparency:-2}),{blur:60,transparency:0});
 assert.deepEqual(normalizeAppearance({blur:NaN,transparency:Infinity}),{blur:10,transparency:60});
});
test('transparency changes the background tint only, including its endpoints',()=>{
 const properties=new Map(),root={style:{setProperty:(key,value)=>properties.set(key,value)}};
 for(const [value,alpha] of [[0,'0'],[5,'0.05'],[60,'0.6'],[100,'1']]){
  applyTransparency(root,value);
  assert.equal(properties.get('--background-alpha'),alpha);
  assert.equal(properties.has('opacity'),false);
 }
});
