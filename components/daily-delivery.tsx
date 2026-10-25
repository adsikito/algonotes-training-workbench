'use client';
import {Cloud,CheckCircle2,FileText,Clock3} from 'lucide-react';
export function DailyDeliveryCard({list,docs,changes,open}:any){
    const card=docs.find((d:any)=>d.id===list?.executionDocId)||docs.find((d:any)=>d.kind==='每日执行卡'&&d.date===list?.date);
    const receipt=changes.find((e:any)=>e.kind==='update'&&e.data.batchId===card?.batchId);
    return <section className="daily-delivery-card"><div><Cloud size={17}/><strong>{card?'本日执行卡已写入':'已有题单已就位'}</strong><span>{list?.date||'自由训练'} · {list?.items?.length||0}题可选</span></div>{card?<><p>{card.summary||'按当前预算选择核心练习，其余不积累补做债。'}</p><div className="button-group"><button className="button small primary" onClick={()=>open(card)}><FileText size={14}/>打开执行卡与STL准备</button><span className="mini"><CheckCircle2 size={13}/>{receipt?'更新批次已确认':'内容可读取'} · 不是已读或完成记录</span></div></>:<p>可打开完整学习单。新的执行卡由原每日任务写入；没有新卡不等于训练失败。</p>}<small><Clock3 size={12}/>提醒时间与实际后台执行分开核验；站内不发送系统弹窗。</small></section>;
}
