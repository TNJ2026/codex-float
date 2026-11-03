import React,{memo,useState} from 'react';
import {FileText,ChevronRight} from 'lucide-react';
import {PreviewDialog} from './PreviewDialog';
import {useLinkAction} from './LinkPreview';
import {fileLabel} from './changed-files';
import {DiffPreview} from './DiffPreview';

const labels={add:'新增',update:'修改',delete:'删除',rename:'重命名'};
function FileRow({file,cwd}){
 const label=fileLabel(file.path,cwd);
 return <><FileText size={14} aria-hidden="true"/><span className="changed-file-path"><span>{label.name}</span><small>{label.relative}</small>{file.previousPath&&<small>原路径：{fileLabel(file.previousPath,cwd).relative}</small>}</span><span className={'changed-file-kind '+file.kind}>{labels[file.kind]}</span></>;
}
export const ChangedFiles=memo(function ChangedFiles({files,cwd}){
 const [expanded,setExpanded]=useState(false);
 const [diffFile,setDiffFile]=useState(null);
 const openLink=useLinkAction();
 if(!files?.length)return null;
 const fileButton=file=><button className="changed-file-row" type="button" key={file.path} aria-haspopup="dialog" title={file.diffs?.length?`查看差异：${file.path}`:file.path} disabled={file.kind==='delete'&&!file.diffs?.length} onClick={()=>file.diffs?.length?setDiffFile(file):openLink(file.path)}><FileRow file={file} cwd={cwd}/>{file.diffs?.length>0&&<span className="changed-file-diff">Diff</span>}</button>;
 return <div className="changed-files">
  <div className="changed-files-summary" role="group" aria-label="修改的文件">
   {files.length>3?<button type="button" className="changed-files-heading" aria-haspopup="dialog" onClick={()=>setExpanded(true)}>修改了 {files.length} 个文件<ChevronRight size={14} aria-hidden="true"/></button>:<div className="changed-files-heading">修改了 {files.length} 个文件</div>}
   {files.slice(0,3).map(fileButton)}
   {files.length>3&&<button type="button" className="changed-files-more" aria-haspopup="dialog" onClick={()=>setExpanded(true)}>另有 {files.length-3} 个文件 · 查看完整列表</button>}
  </div>
  {expanded&&<PreviewDialog title={`修改的文件（${files.length}）`} onClose={()=>setExpanded(false)} className="changed-files-dialog">
   <ul>{files.map(file=><li key={file.path}>{fileButton(file)}</li>)}</ul>
  </PreviewDialog>}
  {diffFile&&<PreviewDialog title={`${fileLabel(diffFile.path,cwd).name} · Diff`} onClose={()=>setDiffFile(null)} className="diff-dialog"><DiffPreview file={diffFile} onOpenFile={()=>openLink(diffFile.path)}/></PreviewDialog>}
 </div>;
});
