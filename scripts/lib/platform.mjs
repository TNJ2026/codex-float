import path from 'node:path';
import os from 'node:os';

// Mirrors the primary Unix endpoint observed in the desktop app's shared IPC module.
export function ipcEndpoint(platform=process.platform,env=process.env){
 const configured=env.CODEX_FLOAT_IPC_PATH;
 if(platform==='win32'){
  const endpoint=configured||'\\\\.\\pipe\\codex-ipc';
  if(!endpoint.startsWith('\\\\.\\pipe\\'))throw Error('Windows IPC must be a local named pipe');
  return endpoint;
 }
 if(platform==='darwin'){
  const home=env.CODEX_HOME||path.posix.join(env.HOME||os.homedir(),'.codex');
  const endpoint=configured??path.posix.join(home,'ipc','ipc.sock');
  if(!path.posix.isAbsolute(endpoint))throw Error('CODEX_FLOAT_IPC_PATH and CODEX_HOME must use absolute paths');
  return endpoint;
 }
 throw Error('Supported native platforms: Windows and macOS');
}
