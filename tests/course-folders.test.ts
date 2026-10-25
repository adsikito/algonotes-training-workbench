import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {expandCourseZip} from '../lib/course-archive.ts';
const bytes=zipSync({'章节/':new Uint8Array(),'章节/空目录/':new Uint8Array(),'章节/code.cpp':strToU8('int main(){}')});
const out=await expandCourseZip(new File([bytes],'课程.zip'));
assert.ok(out.some(f=>f.directory&&f.path==='课程/章节/空目录'));assert.ok(out.some(f=>!f.directory&&f.path==='课程/章节/code.cpp'));
console.log('ZIP import preserves nested files and explicit empty folders; nothing is executed');
