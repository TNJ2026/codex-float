// Read installed application's JavaScript without modifying its package.
import fs from 'node:fs';
const path=process.argv[2];
const fd=fs.openSync(path,'r'),prefix=Buffer.alloc(16);
fs.readSync(fd,prefix,0,16,0);
const size=prefix.readUInt32LE(12),raw=Buffer.alloc(size);
fs.readSync(fd,raw,0,size,16);
const header=JSON.parse(raw),base=8+prefix.readUInt32LE(4);
const terms=process.argv.slice(3);
function walk(files,dir=''){
 for(const [name,entry] of Object.entries(files)){
  const namePath=dir+name;
  if(entry.files){walk(entry.files,namePath+'/');continue;}
  if(terms.includes('--list')&&namePath.startsWith('.vite/build/')){console.log(namePath);continue;}
  if(entry.unpacked||!name.endsWith('.js')||!(namePath.startsWith('.vite/build/')||/app-initial-|app-primary-/.test(name)))continue;
  const data=Buffer.alloc(entry.size);fs.readSync(fd,data,0,data.length,base+Number(entry.offset));
  const source=data.toString();
  for(const term of terms){let i=-1,count=0;while((i=source.indexOf(term,i+1))>=0&&count++<8)console.log(JSON.stringify({file:namePath,term,context:source.slice(Math.max(0,i-220),i+Number(process.env.INSPECT_CONTEXT||650))}));}
 }
}
walk(header.files);fs.closeSync(fd);
