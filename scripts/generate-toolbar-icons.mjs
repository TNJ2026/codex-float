// AppKit loads vector PDF image representations. Keep its toolbar image in
// sync with the shared SVG, without a runtime SVG renderer or rasterization.
import fs from 'node:fs';
for(const name of ['pin','settings']){
const svg=fs.readFileSync(new URL(`../src/assets/${name}.svg`,import.meta.url),'utf8');
const [x,y,width,height]=svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/u).map(Number);
const stroke=Number(svg.match(/stroke-width="([^"]+)"/)[1]);
const scale=16/Math.max(width,height),dx=(16-width*scale)/2-x*scale,dy=16-(16-height*scale)/2+y*scale;
const tokens=svg.match(/ d="([^"]+)"/)[1].trim().split(/\s+/u);
const operators={M:[2,'m'],L:[2,'l'],C:[6,'c'],Z:[0,'h']};
const commands=[];
while(tokens.length){
 const command=tokens.shift(),definition=operators[command];
 if(!definition)throw Error('Unsupported SVG path command: '+command);
 const args=tokens.splice(0,definition[0]);
 if(args.length!==definition[0]||args.some(value=>!Number.isFinite(Number(value))))throw Error('Invalid SVG path');
 commands.push([...args,definition[1]].join(' '));
}
const stream=`q\n${scale} 0 0 ${-scale} ${dx} ${dy} cm\n0 G\n${stroke} w\n1 J\n1 j\n${commands.join('\n')}\nS\nQ\n`;
const objects=[
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 16 16] /Resources << >> /Contents 4 0 R >>',
 `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
];
let pdf='%PDF-1.4\n',offsets=[0];
for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);
pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(new URL(`../src-tauri/icons/${name}-template.pdf`,import.meta.url),pdf);
}
