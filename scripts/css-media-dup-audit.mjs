// 媒体块内『选择器×属性』跨文件重复分析（正确提取版）
import { readFileSync } from 'node:fs';
const files = ['app/globals.css', 'app/workspace.css', 'app/enhancements.css'];

function extractMediaBlocks(css0) {
  const css = css0.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) break;
    const brace = css.indexOf('{', at);
    const cond = css.slice(at, brace).trim().replace('@media ', '');
    let d = 1, j = brace + 1;
    while (d > 0 && j < css.length) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    blocks.push({ cond, inner: css.slice(brace + 1, j - 1), line: css0.slice(0, at).split('\n').length });
    i = j;
  }
  return blocks;
}

function parseRules(inner) {
  const rules = [];
  let i = 0;
  while (i < inner.length) {
    const b = inner.indexOf('{', i);
    if (b === -1) break;
    const sel = inner.slice(i, b).trim().replace(/\s+/g, ' ');
    let d = 1, j = b + 1;
    while (d > 0 && j < inner.length) { if (inner[j] === '{') d++; else if (inner[j] === '}') d--; j++; }
    const body = inner.slice(b + 1, j - 1);
    for (const decl of body.split(';')) {
      const m = decl.match(/^\s*([a-zA-Z-]+)\s*:/);
      if (m) rules.push({ sel, prop: m[1].toLowerCase(), val: decl.slice(decl.indexOf(':') + 1).trim() });
    }
    i = j;
  }
  return rules;
}

const groups = new Map();
for (const f of files) {
  for (const blk of extractMediaBlocks(readFileSync(f, 'utf8'))) {
    for (const r of parseRules(blk.inner)) {
      // 媒体条件归一：min-width:761 与 max-width:760 视作不同条件保留原文
      const key = `${blk.cond} | ${r.sel} | ${r.prop}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ f, line: blk.line, ...r });
    }
  }
}
let n = 0;
for (const [k, v] of groups) {
  if (v.length > 1) { n++; console.log(`■ ${k}`); for (const d of v) console.log(`    ${d.f}:媒体@L${d.line}  ${d.prop}: ${d.val.slice(0, 50)}`); }
}
console.log(`\n媒体块内同选择器×属性多定义组：${n}`);
