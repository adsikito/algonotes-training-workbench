// 一次性审计脚本：列出三份 CSS 中同一『选择器×属性』的多次定义（按导入顺序与源顺序裁决）
import { readFileSync } from 'node:fs';

const files = ['app/globals.css', 'app/workspace.css', 'app/enhancements.css']; // 导入顺序 = 裁决顺序
const order = new Map(files.map((f, i) => [f, i]));

function parse(cssInput, file) {
  const css = cssInput.replace(/\/\*[\s\S]*?\*\//g, ''); // 先剥注释，避免选择器被污染
  const out = [];
  let i = 0, media = '';
  while (i < css.length) {
    if (css[i] === '@') {
      const brace = css.indexOf('{', i);
      const at = css.slice(i, brace).trim();
      if (at.startsWith('@media')) {
        // 找到匹配的闭合大括号
        let depth = 1, j = brace + 1;
        while (depth > 0 && j < css.length) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        const inner = css.slice(brace + 1, j - 1);
        for (const r of parse(inner, file)) out.push({ ...r, media: at.replace('@media ', '') });
        i = j; continue;
      }
      // 其他 at-rule（@import 等）跳过整条
      let j = brace + 1, depth = 1;
      if (css[brace - 1] === ';' || css.slice(i, brace).includes(';')) { const s = css.indexOf(';', i); i = s + 1; continue; }
      while (depth > 0 && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      i = j; continue;
    }
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const sel = css.slice(i, brace).trim().replace(/\s+/g, ' ');
    let depth = 1, j = brace + 1;
    while (depth > 0 && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(brace + 1, j - 1);
    const line = css.slice(0, brace).split('\n').length;
    for (const decl of body.split(';')) {
      const m = decl.match(/^\s*([a-zA-Z-]+)\s*:/);
      if (!m) continue;
      out.push({ file, media: media || '-', sel, prop: m[1].toLowerCase(), val: decl.slice(decl.indexOf(':') + 1).trim(), line });
    }
    i = j;
  }
  return out;
}

const all = [];
for (const f of files) all.push(...parse(readFileSync(f, 'utf8'), f));

// 分组：同 media 上下文 + 同选择器 + 同属性
const groups = new Map();
for (const d of all) {
  const key = `${d.media} | ${d.sel} | ${d.prop}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(d);
}

const dups = [...groups.entries()].filter(([, v]) => v.length > 1)
  .sort((a, b) => order.get(a[1][0].file) - order.get(b[1][0].file));

for (const [key, v] of dups) {
  console.log(`■ ${key}`);
  for (const d of v) console.log(`    ${d.file}:${d.line}  ${d.prop}: ${d.val.slice(0, 60)}`);
}
console.log(`\n共 ${dups.length} 组重复定义`);
