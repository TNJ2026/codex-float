import {t} from './i18n.js';
import {mediaKind} from './rich-content.js';
const imageExtension=/\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)$/iu;
export function linkTarget(value,cwd='') {
 if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f]/u.test(value))throw Error(t("链接地址无效"));
 let path=value.trim();
 if(path.startsWith('codex:')){
  if(!/^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(path))throw Error(t("对话链接无效"));
  return {kind:'url',url:path};
 }
 if(/^https?:\/\//iu.test(path)){
  const url=new URL(path);
  if(!url.hostname)throw Error(t("链接地址无效"));
  const kind=mediaKind(url.pathname);return kind?{kind:'media',mediaType:kind,src:url.href,name:url.pathname.split('/').at(-1)}:{kind:'url',url:url.href};
 }
 if(path.startsWith('#'))return {kind:'anchor',id:decodeURIComponent(path.slice(1))};
 if(/^file:\/\//iu.test(path)){
  const url=new URL(path);
  if(url.hostname&&url.hostname!=='localhost')throw Error(t("暂不支持网络共享路径"));
  path=decodeURIComponent(url.pathname);
 }else{
  // Preserve literal percent characters in ordinary file paths.
  path=path.replace(/#(?:L?\d+(?:C\d+)?(?:-L?\d+)?)$/iu,'');
 }
 path=path.replace(/^\/([a-z]:[\\/])/iu,'$1').replace(/:(\d+)(?::\d+)?$/u,'');
 if(/^(?:\\\\|\/\/)/u.test(path))throw Error(t("暂不支持网络共享路径"));
 if(!/^[a-z]:[\\/]/iu.test(path)&&!/^\//u.test(path)){
  if(/^[a-z][a-z\d+.-]*:/iu.test(path))throw Error(t("不支持此链接类型"));
  if(!cwd)throw Error(t("缺少文件所在目录，请使用绝对路径"));
  path=cwd.replace(/[\\/]$/u,'')+'/'+path;
 }
 const kind=mediaKind(path);return kind?{kind:'media',mediaType:kind,path}:{kind:imageExtension.test(path)?'image':'text',path};
}
