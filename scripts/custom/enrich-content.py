import json,re
p='content/seed.json';s=json.load(open(p));idmap={}
for e in s['problems']:
 old=e['id']
 if 'atcoder.jp' in e['url']:
  m=re.search(r'(ABC\d+)\s+([A-Z])',e['title']);e['code']=m[1]+m[2] if m else e['code'];e['id']=e['code'];idmap[old]=e['id']
 e['difficultyLabel']=e['difficulty'].replace('Codeforces官方','CF ').replace('分','').split('；')[0].replace('力扣官方','').replace('官方未提供难度评级','未评级')
 default={'2026-10-18':['快速幂','快速幂','快速幂与计数','快速幂与计数','快速幂与vector','相对运动','变长窗口'],'2026-10-19':['高精度加法','连续累加','进制加法','数位模拟','string与加法','枚举与最值','前缀和与二分'],'2026-10-20':['高精度减法','数位构造','数位构造','代价构造','sort比较器','因数枚举','前缀和计数'],'2026-10-21':['高精度乘法','阶乘','递推与高精度','贪心与高精度','阶乘统计','排列构造','质数判断'],'2026-10-22':['高精度除法','商与余数','数位枚举','余数递推','priority_queue','有限枚举','排序与贪心'],'2026-10-23':['普通栈','消除过程','括号匹配','括号删除','stack应用','整数操作','排序与变长窗口'],'2026-10-24':['队列模拟','分组队列','循环过程','deque与周期','queue应用','余数分类','答案二分'],'2026-10-25':['频次映射','等价关系计数','前缀状态计数','前缀状态匹配','map与分组','间隔构造','排序与覆盖'],'2026-10-26':['离散化','排序边界','排序与二分','离线端点统计','multiset应用','整数性质','变长窗口']}
 e['knowledge']=default[e['date']][e['position']]
 e['type']=['数值计算','条件应用','目标变式','构造与提升','STL应用','观察与推理','混合应用'][e['position']]
 e['tags']=[e['knowledge'],e['role']]
for l in s['lists']:l['items']=[idmap.get(x,x) for x in l['items']]
assert len(set(e['id'] for e in s['problems']))==63
open(p,'w').write(json.dumps(s,ensure_ascii=False))
