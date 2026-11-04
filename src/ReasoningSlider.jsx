import React,{useEffect,useRef,useState} from 'react';
import {effortIndex,effortLabel,supportedEfforts} from './model-settings';

export function ReasoningSlider({model,effort,disabled,onCommit,onPreviewChange}){
 const options=supportedEfforts(model),index=effortIndex(model,effort),maximum=Math.max(0,options.length-1);
 const [value,setValue]=useState(index),[dragging,setDragging]=useState(false);
 const gesture=useRef(false),input=useRef(),latest=useRef({}),mounted=useRef(true);
 latest.current={options,index,disabled,onCommit,onPreviewChange};
 useEffect(()=>{setValue(index);},[model?.model,index]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(gesture.current){gesture.current=false;latest.current.onPreviewChange?.(false);}};},[]);
 function commit(next){
  const current=latest.current;
  if(current.disabled||!current.options[next])return;
  if(next!==current.index)Promise.resolve(current.onCommit(current.options[next].reasoningEffort)).then(saved=>{if(saved===false&&mounted.current)setValue(latest.current.index);});
 }
 function change(event){
  if(disabled)return;
  const next=Number(event.currentTarget.value);if(!options[next])return;
  setValue(next);
  if(!gesture.current)commit(next);
 }
 function start(event){
  if(disabled||options.length<2)return;
  gesture.current=true;setDragging(true);onPreviewChange?.(true);
  event.currentTarget.setPointerCapture?.(event.pointerId);
 }
 function end(){
  if(!gesture.current)return;
  gesture.current=false;setDragging(false);
  commit(Number(input.current.value));
  latest.current.onPreviewChange?.(false);
 }
 function cancel(){
  if(!gesture.current)return;
  gesture.current=false;setDragging(false);setValue(latest.current.index);latest.current.onPreviewChange?.(false);
 }
 const active=options[value],label=active?effortLabel(active.reasoningEffort):'默认';
 const isDefault=!effort&&value===index;
 return <div className="reasoning-slider">
  <div className="reasoning-heading"><label htmlFor="reasoning-strength-slider">推理强度</label><output htmlFor="reasoning-strength-slider">{label}{isDefault&&active?'（默认）':''}</output><button type="button" className="reasoning-reset" aria-label="恢复默认推理强度" disabled={disabled||dragging||!model||!effort} onClick={()=>onCommit('')}>默认</button></div>
  <input ref={input} id="reasoning-strength-slider" type="range" min="0" max={maximum} step="1" value={value} aria-label="推理强度" aria-valuetext={`${label}${isDefault?'（默认）':''}`} aria-describedby={active?.description?'reasoning-strength-description':undefined} disabled={disabled||options.length<2} style={{'--range-progress':`${maximum?value/maximum*100:0}%`}} onChange={change} onPointerDown={start} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={end}/>
  <div className="reasoning-scale" aria-hidden="true">{options.map((option,position)=><span key={option.reasoningEffort} style={{left:`${maximum?position/maximum*100:0}%`}} data-active={position===value?'true':undefined}>{effortLabel(option.reasoningEffort)}</span>)}</div>
  {active?.description&&<p id="reasoning-strength-description" className="reasoning-description">{active.description}</p>}
 </div>;
}
