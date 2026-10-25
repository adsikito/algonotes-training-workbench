import { unzip } from 'fflate';
import { BATCH_BYTES,BATCH_LIMIT,FILE_LIMIT,checkBatch,relativePath } from './file-policy.ts';
export async function expandCourseZip(file: File): Promise<{file:File;path:string;directory?:boolean}[]> {
    if (file.size > FILE_LIMIT) throw new Error('课程ZIP压缩包上限20MiB，请按章节拆包');
    const bytes=new Uint8Array(await file.arrayBuffer()); let total=0,count=0; const seen=new Set<string>();const directories:string[]=[];
    const result=await new Promise<Record<string,Uint8Array>>((resolve,reject)=>{
        try { unzip(bytes,{filter:info=>{
            if(info.name.endsWith('/')){const path=relativePath(info.name.slice(0,-1));if(seen.has(path))throw new Error('压缩包包含重复目录');seen.add(path);directories.push(path);if(++count>BATCH_LIMIT)throw new Error('ZIP目录与文件合计最多200项');return false;}
            const path=relativePath(info.name);
            if(seen.has(path)) throw new Error('压缩包包含重复路径'); seen.add(path);
            total+=info.originalSize;count++;
            if(info.originalSize>FILE_LIMIT||total>BATCH_BYTES||count>BATCH_LIMIT||info.originalSize>Math.max(1,info.size)*1000) throw new Error('ZIP展开超限：最多200个文件、总100MiB、单文件20MiB');
            return true;
        }},(error,files)=>error?reject(error):resolve(files)); } catch(e){reject(e);}
    });
    const root=file.name.replace(/\.zip$/i,'') || '课程资料';
    const files:{file:File;path:string;directory?:boolean}[]=Object.entries(result).map(([path,data])=>({file:new File([data as Uint8Array<ArrayBuffer>],path.split('/').at(-1)!),path:relativePath(root+'/'+path)}));
    files.push(...directories.map(path=>({file:new File([],path.split('/').at(-1)!),path:relativePath(root+'/'+path),directory:true})));
    checkBatch(files.map(f=>({path:f.path,size:f.file.size})));
    return files;
}
