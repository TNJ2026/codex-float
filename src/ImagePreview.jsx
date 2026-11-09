import React,{useLayoutEffect,useRef,useState} from 'react';
import {t,useLanguage} from './i18n';

// Coordinates are relative to the center of the viewport; scale is the original pixel ratio.
export function ImagePreview({src,alt,onError,onContextMenu}){
 useLanguage();
 const viewport=useRef(null),image=useRef(null),pointers=useRef(new Map()),gesture=useRef(null);
 const current=useRef({scale:1,x:0,y:0}),size=useRef({width:0,height:0}),fitting=useRef(true);
 const [view,setView]=useState(current.current),[ready,setReady]=useState(false),[dragging,setDragging]=useState(false);
 function fitScale(){
  const el=viewport.current,{width,height}=size.current;
  return width&&height?Math.min(1,el.clientWidth/width,el.clientHeight/height):1;
 }
 function update(next){
  const el=viewport.current,{width,height}=size.current;
  const maxX=Math.max(0,(width*next.scale-el.clientWidth)/2),maxY=Math.max(0,(height*next.scale-el.clientHeight)/2);
  next={...next,x:Math.max(-maxX,Math.min(maxX,next.x)),y:Math.max(-maxY,Math.min(maxY,next.y))};
  current.current=next;setView(next);
 }
 function fit(){fitting.current=true;update({scale:fitScale(),x:0,y:0});}
 function zoom(scale,point={x:0,y:0}){
  const prev=current.current,next=Math.max(Math.min(fitScale(),0.1),Math.min(8,scale)),ratio=next/prev.scale;
  fitting.current=false;
  update({scale:next,x:point.x-(point.x-prev.x)*ratio,y:point.y-(point.y-prev.y)*ratio});
 }
 function point(event){const rect=viewport.current.getBoundingClientRect();return {x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2};}
 useLayoutEffect(()=>{
  const el=viewport.current;
  const wheel=event=>{
   event.preventDefault();
   if(!size.current.width)return;
   const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
   zoom(current.current.scale*Math.exp(-Math.max(-300,Math.min(300,delta))*0.002),point(event));
  };
  const resize=()=>{if(size.current.width){if(fitting.current)fit();else update(current.current);}};
  el.addEventListener('wheel',wheel,{passive:false});
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);
  observer?.observe(el);window.addEventListener('resize',resize);
  return()=>{el.removeEventListener('wheel',wheel);observer?.disconnect();window.removeEventListener('resize',resize);};
 },[]);
 function beginGesture(){
  const points=[...pointers.current.values()];
  if(points.length===2){
   const [a,b]=points;
   gesture.current={distance:Math.hypot(b.x-a.x,b.y-a.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},view:{...current.current}};
  }else gesture.current=null;
 }
 function down(event){
  if(event.button!==0||!ready)return;
  event.preventDefault();viewport.current.focus({preventScroll:true});
  viewport.current.setPointerCapture?.(event.pointerId);
  pointers.current.set(event.pointerId,point(event));beginGesture();setDragging(true);
 }
 function move(event){
  const previous=pointers.current.get(event.pointerId);if(!previous)return;
  const next=point(event);pointers.current.set(event.pointerId,next);
  if(pointers.current.size===2&&gesture.current){
   const [a,b]=[...pointers.current.values()],g=gesture.current,center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
   const scale=Math.max(Math.min(fitScale(),0.1),Math.min(8,g.view.scale*Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,g.distance))),ratio=scale/g.view.scale;
   fitting.current=false;update({scale,x:center.x-(g.center.x-g.view.x)*ratio,y:center.y-(g.center.y-g.view.y)*ratio});
  }else if(pointers.current.size===1){fitting.current=false;update({...current.current,x:current.current.x+next.x-previous.x,y:current.current.y+next.y-previous.y});}
 }
 function up(event){pointers.current.delete(event.pointerId);beginGesture();setDragging(pointers.current.size>0);}
 function keys(event){
  if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){onContextMenu?.(event);return;}
  const actions={'+':()=>zoom(current.current.scale*1.25),'=':()=>zoom(current.current.scale*1.25),'-':()=>zoom(current.current.scale/1.25),'0':fit,'1':()=>zoom(1),ArrowLeft:()=>update({...current.current,x:current.current.x+40}),ArrowRight:()=>update({...current.current,x:current.current.x-40}),ArrowUp:()=>update({...current.current,y:current.current.y+40}),ArrowDown:()=>update({...current.current,y:current.current.y-40})};
  if(ready&&actions[event.key]){event.preventDefault();actions[event.key]();}
 }
 return <div className="image-preview">
  <div className="image-preview-toolbar" role="group" aria-label={t('图片缩放')}>
   <button type="button" disabled={!ready||view.scale<=Math.min(fitScale(),0.1)} aria-label={t('缩小图片')} onClick={()=>zoom(current.current.scale/1.25)}>−</button>
   <output aria-label={t('缩放比例')}>{Math.round(view.scale*100)}%</output>
   <button type="button" disabled={!ready||view.scale>=8} aria-label={t('放大图片')} onClick={()=>zoom(current.current.scale*1.25)}>+</button>
   <button type="button" disabled={!ready} onClick={fit}>{t('适应窗口')}</button>
   <button type="button" disabled={!ready} onClick={()=>zoom(1)}>{t('原图比例')}</button>
  </div>
  <div ref={viewport} className="image-preview-viewport" data-dragging={dragging||undefined} tabIndex={0} role="region" aria-label={t('图片预览：滚轮缩放，拖拽移动')} onContextMenu={onContextMenu} onKeyDown={keys} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onDoubleClick={event=>{if(ready){if(fitting.current)zoom(1,point(event));else fit();}}}>
   <img ref={image} src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" style={{width:size.current.width||undefined,height:size.current.height||undefined,visibility:ready?'visible':'hidden',transform:`translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`}} onLoad={()=>{size.current={width:image.current.naturalWidth,height:image.current.naturalHeight};fit();setReady(true);}} onError={onError}/>
  </div>
 </div>;
}
