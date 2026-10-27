'use client';
import { useEffect, useRef, useState } from 'react';
import { writeDraft, removeDraft } from '../lib/drafts';
import type { Entry } from '../lib/domain';
/* 共享同步引擎（03 §7 共享组件 #7 / §6.13 ⑧.6）：QuickProblemNote × NoteEditor 抽公共 writeDraft/flush 状态机。
   行为契约逐条冻结：IME composition 期间不 flush（结束后 700ms 补拍）、change 后 900ms flush、
   保存成功仍有新内容时 800ms 补拍、空笔记不落库（K2✔，仅对未上云的新笔记生效）、
   附件上传前“未保存先存”顺序守卫由消费方调用 primeForAttachment() 实现（:61-70 原语义）、
   关闭未同步提示由消费方读取 dirty.current 实现。
   两消费方文案差异（『本机已保存/本机草稿已保存』『未同步 ·/未同步：』等）经 messages 参数逐字保留。 */
export interface NoteSyncMessages {
    draftSaved: string;
    draftSavedOffline: string;
    draftFailed: string;
    syncing: string;
    saved: string;
    pending?: string;
    failed: (message: string) => string;
    skippedEmpty: string;
}
export interface NoteSyncOptions {
    key: string;
    entry: Entry;
    save: (kind: 'note', data: any, old: Entry | null, id: string) => Promise<Entry>;
    onSaved?: (out: Entry) => void;
    messages: NoteSyncMessages;
    initialStatus: string;
    /* K2✔ 空笔记判定：仅当云端 version 为 0（从未上云）且判定为空时跳过保存并清掉本机草稿 */
    isEmpty?: (data: any) => boolean;
    /* 工作区初始值：NoteEditor 原实现 latest 初值为 null（附件首存走 live 字段兜底），QuickNote 为初始 data；逐 consumer 冻结 */
    initialData?: any;
}
export function useNoteSync({ key, entry, save, onSaved, messages, initialStatus, isEmpty, initialData }: NoteSyncOptions) {
    const [status, setStatus] = useState(initialStatus);
    const current = useRef<Entry>(entry), latest = useRef<any>(initialData !== undefined ? initialData : entry.data);
    const dirty = useRef(false), saving = useRef(false), composing = useRef(false), timer = useRef<any>(null);
    const saveRef = useRef(save);
    saveRef.current = save;
    useEffect(() => () => { clearTimeout(timer.current); }, []);
    function schedule(delay = 900) { clearTimeout(timer.current); timer.current = setTimeout(() => { flush(); }, delay); }
    async function flush(): Promise<Entry> {
        if (saving.current || !dirty.current || composing.current)
            return current.current;
        saving.current = true;
        const snapshot = latest.current;
        dirty.current = false;
        if (snapshot == null) {
            saving.current = false;
            return current.current;
        }
        if (!current.current.version && isEmpty && isEmpty(snapshot)) {
            await removeDraft(key);
            setStatus(messages.skippedEmpty);
            saving.current = false;
            return current.current;
        }
        setStatus(messages.syncing);
        try {
            const out = await saveRef.current('note', snapshot, current.current, current.current.id);
            current.current = out;
            onSaved?.(out);
            if (!dirty.current) {
                await removeDraft(key);
                setStatus(messages.saved);
            }
            else {
                if (messages.pending !== undefined)
                    setStatus(messages.pending);
                timer.current = setTimeout(() => { flush(); }, 800);
            }
            return out;
        }
        catch (e: any) {
            dirty.current = true;
            setStatus(messages.failed(e.message));
            return current.current;
        }
        finally {
            saving.current = false;
        }
    }
    /* change：消费方自行合并出 next（各自合并语义冻结），本方法负责 本机草稿写入 + 状态文案 + 900ms 排程 */
    function update(next: any) {
        latest.current = next;
        dirty.current = true;
        writeDraft(key, { data: next, baseVersion: current.current.version, at: new Date().toISOString() })
            .then(() => setStatus(navigator.onLine ? messages.draftSaved : messages.draftSavedOffline))
            .catch(() => setStatus(messages.draftFailed));
        schedule(900);
    }
    /* 恢复本机草稿（NoteEditor 恢复按钮 / QuickProblemNote 挂载自动恢复共用）：回填 baseVersion 并置脏 */
    function adoptDraft(draft: any) {
        latest.current = draft.data;
        dirty.current = true;
        current.current = { ...current.current, version: draft.baseVersion ?? current.current.version };
    }
    /* NoteEditor 新笔记挂载（!version 且有正文）：先落本机草稿并排程首次上云（原 :15-27 语义） */
    function bootstrap() {
        latest.current = { ...entry.data };
        dirty.current = true;
        writeDraft(key, { data: entry.data, baseVersion: 0, at: new Date().toISOString() })
            .then(() => setStatus(messages.draftSaved))
            .catch(() => { });
        schedule(900);
    }
    /* IME composition 防抖：开始暂停排程，结束 700ms 后补拍 */
    function beginCompose() { composing.current = true; clearTimeout(timer.current); }
    function endCompose() { composing.current = false; schedule(700); }
    /* 附件顺序守卫原语：暴露 saving 语义供消费方实现“未保存先存再传附件”（NoteEditor attach :61-70） */
    function isSaving() { return saving.current; }
    function cancelSchedule() { clearTimeout(timer.current); }
    function beginManualSave() { saving.current = true; clearTimeout(timer.current); }
    function endManualSave() { saving.current = false; }
    function markSaved(out: Entry) { current.current = out; onSaved?.(out); }
    return { status, setStatus, current, latest, dirty, update, flush, adoptDraft, bootstrap, beginCompose, endCompose, isSaving, cancelSchedule, beginManualSave, endManualSave, markSaved };
}
