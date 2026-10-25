'use client';
import { useState } from 'react';
import { Modal } from './workspace-ui';
export function AskBox({ box, close }: { box: { title: string; label: string; value: string; apply: (v: string) => void; cancel?: () => void }; close: () => void }) {
    const [v, setV] = useState(box.value);
    return <Modal title={box.title} close={() => { box.cancel?.(); close(); }}><div className="prompt-form"><label>{box.label}<input autoFocus value={v} aria-label={box.label} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { box.apply(v.trim()); close(); } }}/></label><div className="button-group"><button className="button primary" disabled={!v.trim()} onClick={() => { box.apply(v.trim()); close(); }}>保存</button><button className="button" onClick={() => { box.cancel?.(); close(); }}>取消</button></div></div></Modal>;
}
