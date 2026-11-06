import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ipcEndpoint} from './lib/platform.mjs';

test('desktop IPC uses a Windows pipe or the desktop home Unix socket with an optional override',()=>{
 assert.equal(ipcEndpoint('win32',{}),'\\\\.\\pipe\\codex-ipc');
 assert.equal(ipcEndpoint('win32',{CODEX_FLOAT_IPC_PATH:'\\\\.\\pipe\\custom'}),'\\\\.\\pipe\\custom');
 assert.equal(ipcEndpoint('darwin',{CODEX_FLOAT_IPC_PATH:'/tmp/verified socket.sock'}),'/tmp/verified socket.sock');
 assert.equal(ipcEndpoint('darwin',{HOME:'/Users/test'}),'/Users/test/.codex/ipc/ipc.sock');
 assert.equal(ipcEndpoint('darwin',{CODEX_HOME:'/tmp/configured'}),'/tmp/configured/ipc/ipc.sock');
 assert.throws(()=>ipcEndpoint('darwin',{CODEX_FLOAT_IPC_PATH:'relative.sock'}));
 assert.throws(()=>ipcEndpoint('win32',{CODEX_FLOAT_IPC_PATH:'/tmp/socket'}));
 assert.throws(()=>ipcEndpoint('linux',{}));
});

test('Windows APIs remain isolated from shared services and target dependencies',()=>{
 const cargo=fs.readFileSync(new URL('../src-tauri/Cargo.toml',import.meta.url),'utf8');
 const windows=cargo.indexOf('[target.\'cfg(target_os = "windows")\'.dependencies]');
 assert.ok(windows>0);
 for(const dependency of ['windows-sys =','windows =','windows-core ='])assert.ok(cargo.indexOf(dependency)>windows);
 for(const file of fs.readdirSync(new URL('../src-tauri/src/services/',import.meta.url))){
  const source=fs.readFileSync(new URL('../src-tauri/src/services/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/std::os::windows|windows_sys::|tokio::net::windows/u);
 }
});

test('shared Tauri config contains no Windows-only material and each platform has a complete window override',()=>{
 const read=file=>JSON.parse(fs.readFileSync(new URL('../src-tauri/'+file,import.meta.url),'utf8'));
 const common=read('tauri.conf.json'),windows=read('tauri.windows.conf.json'),macos=read('tauri.macos.conf.json');
 assert.equal(common.app.windows[0].noRedirectionBitmap,undefined);
 assert.equal(common.app.windows[0].windowEffects,undefined);
 assert.equal(windows.app.windows[0].noRedirectionBitmap,true);
 assert.equal(windows.app.windows[0].decorations,true);
 // Native setup selects Liquid Glass at runtime, with Vibrancy on older OSes.
 assert.equal(macos.app.windows[0].windowEffects,undefined);
 assert.equal(macos.bundle.macOS.minimumSystemVersion,'13.0');
 // The locked Tauri version always enables transparent macOS windows. The old
 // opt-in makes plain cargo test fail its dependency/config feature check.
 assert.equal(macos.app.macOSPrivateApi,undefined);
 assert.equal(macos.app.windows[0].decorations,true);
 assert.equal(macos.app.windows[0].titleBarStyle,'Overlay');
 assert.equal(macos.app.windows[0].hiddenTitle,false);
 assert.equal(macos.app.windows[0].trafficLightPosition,undefined,'AppKit owns the toolbar layout');
 for(const config of [windows,macos]){
  assert.equal(config.app.windows.length,1);
  assert.equal(config.app.windows[0].label,'main');
  assert.equal(config.app.windows[0].width,common.app.windows[0].width);
  assert.equal(config.app.windows[0].transparent,true);
 }
});
