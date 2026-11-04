import React from 'react';
import {ChevronRight} from 'lucide-react';
import {workDurationLabel} from './work-timing';

export function WorkDetails({items,children,durationMs}){
 return <details className="work-details">
  <summary aria-label="展开或收起工作过程"><span>上 {items.length} 条消息</span><ChevronRight size={14}/><small className="work-duration" title="本轮任务从开始到结束的总耗时">用时 {workDurationLabel(durationMs)}</small></summary>
  <div className="work-details-body">{children}</div>
 </details>;
}
