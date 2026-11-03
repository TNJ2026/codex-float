const imageExtension=/\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)$/iu;
export function linkTarget(value,cwd='') {
 if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f]/u.test(value))throw Error('链接地址无效');
 let path=value.trim();
 if(/^https?:\/\//iu.test(path)){
  const url=new URL(path);
  if(!url.hostname)throw Error('链接地址无效');
  return {kind:'url',url:url.href};
 }
 if(path.startsWith('#'))return {kind:'anchor',id:decodeURIComponent(path.slice(1))};
 if(/^file:\/\//iu.test(path)){
  const url=new URL(path);
  if(url.hostname&&url.hostname!=='localhost')throw Error('暂不支持网络共享路径');
  path=decodeURIComponent(url.pathname);
 }else{
  // Preserve literal percent characters in ordinary file paths.
  path=path.replace(/#(?:L?\d+(?:C\d+)?(?:-L?\d+)?)$/iu,'');
 }
 path=path.replace(/^\/([a-z]:[\\/])/iu,'$1').replace(/:(\d+)(?::\d+)?$/u,'');
 if(/^(?:\\\\|\/\/)/u.test(path))throw Error('暂不支持网络共享路径');
 if(!/^[a-z]:[\\/]/iu.test(path)&&!/^\//u.test(path)){
  if(/^[a-z][a-z\d+.-]*:/iu.test(path))throw Error('不支持此链接类型');
  if(!cwd)throw Error('缺少文件所在目录，请使用绝对路径');
  path=cwd.replace(/[\\/]$/u,'')+'/'+path;
 }
 return {kind:imageExtension.test(path)?'image':'text',path};
}
