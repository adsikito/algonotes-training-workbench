'use client';
import { useEffect } from 'react';
import { ChevronLeft, Download, History, Pencil, Paperclip } from 'lucide-react';
import { Markdown, Pill } from './workspace-ui';
import { FileDownload } from './file-download';
import { download } from '../lib/backup-client';
import { folderRows, noteProblemIds } from '../lib/workspace';

/* 笔记全页阅读 note 变体（03 §6.7 change3）：笔记行点击=读（本组件，复用 .reading-page 骨架与阅读 token）；
   『编辑笔记』唯一 primary → NoteEditor（编）；附件/元数据入右轨。深链协议不覆盖笔记（state 级浮层，Esc/返回关闭）。 */
export function NoteReader({ entry, entries, folders, files, problems, close, onEdit, onHistory }: any) {
    const title = entry.data.title || '未命名笔记';
    /* 决策⑪：页面级导航语义——title 联动 + 返回钮 autoFocus + Esc（workbench 全局）承载 */
    useEffect(() => { const prev = document.title; document.title = title + ' · AlgoNotes'; return () => { document.title = prev; }; }, [title]);
    const rows = folderRows(folders ?? []);
    const folderPath = rows.find(r => r.entry.id === entry.data.folderId)?.path || (entry.data.folderId ? (String(entries?.find((f: any) => f.id === entry.data.folderId)?.data.title ?? '未知目录') + '（已回收）') : '收件箱');
    const linked = noteProblemIds(entry.data).map((id: string) => problems?.find((p: any) => p.id === id)).filter(Boolean);
    const attachments = (files ?? []).filter((f: any) => (entry.data.fileIds ?? []).includes(f.id) || f.data.parentId === entry.id || entry.data.sourceFileId === f.id);
    return <div className="reading-page" data-reading-title={title}>
        <header className="reading-topbar"><button className="text-button" autoFocus onClick={close}><ChevronLeft size={16}/>返回工作台</button><div className="reading-heading"><Pill>笔记</Pill><h2>{title}</h2></div><div className="button-group"><button className="button small" onClick={onHistory}><History size={14}/>历史版本</button><button className="button small" onClick={() => download(entry.data.body || '', title + '.md', 'text/markdown')}><Download size={14}/>下载 MD</button><button className="button small primary" onClick={onEdit}><Pencil size={14}/>编辑笔记</button></div></header>
        <div className="reading-layout"><div className="reading-main"><div className="document-body"><Markdown body={entry.data.body || '*还没有正文。点右上角「编辑笔记」写下第一句。*'}/></div></div>
        <aside className="reading-rail">
            <section className="linked-notes-rail"><h3>笔记信息</h3><p className="tiny">所在文件夹：{folderPath}</p>{(entry.data.tags ?? []).length > 0 && <p className="tiny">标签：{entry.data.tags.join(' · ')}</p>}<p className="tiny">更新：{new Date(entry.updated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>{linked.length > 0 && <p className="tiny">关联题目：{linked.map((p: any) => p.code).join(' · ')}</p>}</section>
            {attachments.length > 0 && <section className="linked-notes-rail"><h3>附件 · {attachments.length}</h3>{attachments.map((f: any) => <div className="linked-note" key={f.id}><Paperclip size={15}/>{f.data.name}<FileDownload entry={f}/></div>)}</section>}
        </aside></div>
    </div>;
}
