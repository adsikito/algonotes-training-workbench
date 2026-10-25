/** Shared upload and preview rules. Original bytes are always preserved. */
export const FILE_LIMIT = 20 * 1024 * 1024;
export const BATCH_LIMIT = 200;
export const BATCH_BYTES = 100 * 1024 * 1024;
export const TEXT_LIMIT = 200000;
export const textExtensions = new Set(['txt','md','cpp','cc','cxx','c','h','hpp','py','java','js','ts','tsx','jsx','json','csv','in','out','ans','log','sql','yaml','yml','xml','css','html','sh']);
export function extension(name: string) { return name.split('.').at(-1)?.toLowerCase() ?? ''; }
export function fileCapability(name: string) {
    const ext = extension(name);
    if (textExtensions.has(ext)) return { kind: 'text', label: '文本 / 代码', preview: '文本预览与内容检索', mime: 'text/plain' };
    if (ext === 'pdf') return { kind: 'pdf', label: 'PDF', preview: 'PDF预览；暂不提取全文', mime: 'application/pdf' };
    const images: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' };
    if (images[ext]) return { kind: 'image', label: '图片', preview: '图片预览', mime: images[ext] };
    if (['ppt','pptx','doc','docx','xls','xlsx'].includes(ext)) return { kind:'office',label:'Office课件',preview:'原件保存与下载；在线转换尚未接入',mime:'application/octet-stream' };
    if (ext === 'zip') return { kind:'archive',label:'ZIP压缩包',preview:'可保存原件；课程ZIP可先预览再展开导入',mime:'application/octet-stream' };
    return { kind:'binary',label:'原始文件',preview:'保存与下载，不执行文件',mime:'application/octet-stream' };
}
export function relativePath(raw: string) {
    const path = raw.normalize('NFC');
    if (!path || path.length > 1000 || /[\\\u0000-\u001f]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(p => !p || p === '.' || p === '..' || p.length > 180) || path.split('/').length > 16) throw new Error('文件路径不安全或目录超过15层');
    return path;
}
export function decodeSource(bytes: ArrayBuffer) {
    const data = new Uint8Array(bytes);
    if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data), encoding: 'UTF-16LE' };
    if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(data), encoding: 'UTF-16BE' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'UTF-8' }; }
    catch { return { text: new TextDecoder('gb18030').decode(data), encoding: 'GB18030（自动兼容）' }; }
}
export function sourceIndex(name: string, bytes: ArrayBuffer) {
    if (fileCapability(name).kind !== 'text') return { body:'',encoding:'',indexed:false,indexTruncated:false };
    if (bytes.byteLength > 2 * 1024 * 1024) return { body:'',encoding:'',indexed:false,indexTruncated:true };
    const decoded = decodeSource(bytes);
    if (decoded.text.includes('\u0000')) return { body:'',encoding:'',indexed:false,indexTruncated:false };
    let body = decoded.text.slice(0,TEXT_LIMIT);
    while (new TextEncoder().encode(body).length > TEXT_LIMIT) body = body.slice(0,Math.floor(body.length * .8));
    return { body, encoding:decoded.encoding,indexed:true,indexTruncated:body.length < decoded.text.length };
}
export function checkBatch(files: { size:number; path:string }[]) {
    if (!files.length) throw new Error('请选择文件');
    if (files.length > BATCH_LIMIT) throw new Error(`单批最多${BATCH_LIMIT}个文件，请拆分目录`);
    if (files.reduce((n,f)=>n+f.size,0) > BATCH_BYTES) throw new Error('单批总大小上限100MiB，请拆分目录');
    for (const f of files) { relativePath(f.path); if (f.size > FILE_LIMIT) throw new Error(`${f.path} 超过单文件20MiB上限`); }
}
