// Only image sources are converted; ordinary message links remain inert.
export function imageSource(value, convertLocal = () => '') {
 if (typeof value !== 'string') return '';
 const source=value.trim();
 if (!source || /[\u0000-\u001f]/u.test(source)) return '';
 if (/^https?:\/\//iu.test(source) || /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon);base64,[a-z\d+/=\s]+$/iu.test(source)) return source;
 let path=source;
 if (/^file:\/\//iu.test(path)) {
  try {
   const url=new URL(path);
   if (url.hostname && url.hostname!=='localhost') return ''; // Avoid network shares.
   path=decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/iu,'$1');
  } catch { return ''; }
 }
 path=path.replace(/^\/([a-z]:[\\/])/iu,'$1');
 if (/^[a-z]:[\\/]/iu.test(path) || /^\/(?!\/)/u.test(path)) return convertLocal(path);
 return '';
}

const emptyImages=Object.freeze([]);
const imageCache=new WeakMap();
const generatedImageCache=new WeakMap();
export function generatedImagesOf(item) {
 if (item.status!=='completed') return emptyImages;
 if (generatedImageCache.has(item)) return generatedImageCache.get(item);
 // Desktop imageGeneration items carry the image separately from agentMessage text.
 // Prefer inline pixels: the saved file can be moved or deleted after generation.
 const result=typeof item.result==='string'?item.result.trim():'';
 let src='';
 if (/^data:image\//iu.test(result)) src=imageSource(result);
 else if (/^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/u.test(result) && /^[a-z\d+/=\s]+$/iu.test(result)) {
  const type=result.startsWith('/9j/')?'jpeg':result.startsWith('R0lGOD')?'gif':result.startsWith('UklGR')?'webp':'png';
  src=`data:image/${type};base64,${result}`;
 }
 src=src||item.savedPath||item.src||'';
 const images=src?[{id:item.id,src,alt:'生成的图片'}]:emptyImages;
 generatedImageCache.set(item,images);
 return images;
}
export function imagesOf(content) {
 if (!Array.isArray(content)) return emptyImages;
 if (imageCache.has(content)) return imageCache.get(content);
 // Conversation patches copy changed paths, so untouched attachment arrays can be reused.
 const images=content.flatMap((part,index)=>{
  if (!['image','input_image','localImage','local_image'].includes(part?.type)) return [];
  const source=part.path ?? part.url ?? part.image_url;
  const src=typeof source==='string'?source:source?.url;
  return src?[{id:String(index),src,alt:part.alt||'图片附件'}]:[];
 });
 const result=images.length?images:emptyImages;
 imageCache.set(content,result);
 return result;
}
