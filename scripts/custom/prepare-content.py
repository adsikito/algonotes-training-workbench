from pathlib import Path
import re,json
root=Path('/workspace/scratch/ca933fe3da00/site_content')
problems={};lists=[];docs=[]
nums='①②③④⑤⑥⑦';roles=['基础入口','专题应用','专题变式','挑战选做','STL练习','思维训练','其他专题']
for f in sorted(root.glob('每日集训*.md')):
 text=f.read_text();date=re.search(r'2026-\d{2}-\d{2}',f.name)[0]
 title=re.search(r'^# (.+)$',text,re.M)[1]
 heads=list(re.finditer(r'^## ([①②③④⑤⑥⑦]) (.+)$',text,re.M));items=[]
 for i,m in enumerate(heads):
  section=text[m.end():heads[i+1].start() if i+1<len(heads) else len(text)]
  if i==len(heads)-1:
   end=re.search(r'^## (?![①②③④⑤⑥⑦])',section,re.M)
   if end:section=section[:end.start()]
  link=re.search(r'https?://(?:www\.luogu\.com\.cn/problem/[^)\s]+|codeforces.com/problemset/problem/[^)\s]+|leetcode.cn/problems/[^)\s]+|atcoder.jp/contests/[^)\s]+|onlinejudge.org/[^)\s]+)',section)
  url=link[0] if link else ''
  code=m[2].split(' ')[0];pid=code.replace('/','-').replace('力扣','LC')
  difficulty=re.search(r'\*\*难度[：:]([^*]+)',section)
  difficulty=difficulty[1].strip('。 ') if difficulty else '官方未提供评级'
  p={'id':pid,'code':code,'title':m[2],'url':url,'difficulty':difficulty,'body':section.strip(),'topic':title,'date':date,'position':nums.index(m[1]),'role':roles[nums.index(m[1])],'type':roles[nums.index(m[1])],'tags':[title,roles[nums.index(m[1])]],'minutes':30,'sourceVersion':'2026-10-22替换版','verifiedAt':'2026-10-22','rate':None}
  if pid in problems: raise Exception('duplicate '+pid)
  problems[pid]=p;items.append(pid)
 stlstart=re.search(r'^## (?:每日STL|STL|知识点)',text,re.M)
 docs.append({'id':'daily-'+date,'title':title,'date':date,'body':text,'filename':f.name,'kind':'日单原文'})
 lists.append({'id':date,'date':date,'title':title,'items':items,'intro':text[:heads[0].start()] if heads else text})
stl=root/'STL竞赛专题_15模块_30项专门练习.md'; text=stl.read_text()
heads=list(re.finditer(r'^## (\d+)[.、． ](.*)$',text,re.M))
if not heads:
 print('STL headings:',re.findall(r'^#{1,3} .+',text,re.M)[:30])
for i,m in enumerate(heads):
 end=heads[i+1].start() if i+1<len(heads) else len(text)
 docs.append({'id':'stl-'+m[1],'title':m[2].strip(),'body':text[m.start():end].strip(),'kind':'STL专题','module':int(m[1])})
if not heads:docs.append({'id':'stl-full','title':'STL竞赛专题 · 15模块与30项练习','body':text,'kind':'STL专题'})
for name in ['算法训练工作台_完整实现方案与执行路线_v1.md','算法训练工作台_全面审查与修改清单.md']:
 f=Path('/workspace/scratch/ca933fe3da00/upload')/name
 if f.exists():docs.append({'id':'spec-'+str(len(docs)),'title':f.stem,'body':f.read_text(),'kind':'项目文档'})
Path('content/seed.json').write_text(json.dumps({'problems':list(problems.values()),'lists':lists,'docs':docs},ensure_ascii=False))
print({'problems':len(problems),'lists':len(lists),'documents':len(docs),'stl':len(heads)})
