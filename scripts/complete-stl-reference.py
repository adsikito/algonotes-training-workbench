"""Curated C++11 API cards; compile/run verification writes reproducible examples.
The 45 existing extension cards retain their authored contracts and use their module demo.
"""
import json,re,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
r=json.loads((root/'content/stl-reference.json').read_text());seed=json.loads((root/'content/seed.json').read_text())
# signature | returns | legal conditions and invalidation | standalone main body | expected output
raw=r'''
v.push_back(x)|void；追加一个元素，size增加1|扩容时所有旧迭代器、指针和引用失效；未扩容时旧end失效。|vector<int> v; v.push_back(8); v.push_back(3); show(v);|8 3
v.pop_back()|void；删除末项，不返回被删的值|必须非空；需要值先复制back()；被删元素及旧end失效。|vector<int> v{8,3}; int x=v.back(); v.pop_back(); cout<<x<<" "<<v.size()<<"\n";|3 1
v.size(); v.empty()|size_type（无符号元素数）；bool（是否为空）|空容器可以调用；size不是最大合法下标。|vector<int> v; cout<<v.size()<<" "<<v.empty()<<"\n"; v.push_back(4); cout<<v.size()<<" "<<v.empty()<<"\n";|0 1\n1 0
v.resize(n); v.resize(n,value)|void；改变元素数量，增长部分填value或值初始化|缩小不保证释放容量；增长若扩容则全部旧引用失效；被删元素引用失效。|vector<int> v{4,8}; v.resize(4,7); show(v); v.resize(1); show(v);|4 8 7 7\n4
v.reserve(n)|void；保证至少可容纳n个元素，不创建元素|n<=capacity不扩容；实际扩容则所有迭代器和引用失效；不能随后访问v[size()]。|vector<int> v{4}; v.reserve(20); cout<<v.size()<<" "<<(v.capacity()>=20)<<"\n";|1 1
v.assign(n,value); v.assign(first,last)|void；替换整个序列|不是追加；全部旧迭代器、指针和引用失效。|vector<int> v{1,2}; v.assign(3,6); show(v);|6 6 6
v.at(i); v[i]|T&（const对象为const T&），可以读写有效元素|i<size；at越界抛out_of_range；[]越界无检查，不会扩容。|vector<int> v{8,3}; v.at(1)=6; cout<<v[1]<<"\n"; try{v.at(2);}catch(const out_of_range&){cout<<"out\n";}|6\nout
v.insert(pos,x); v.erase(pos); v.erase(first,last)|iterator：插入元素位置 / 删除段之后的位置|pos属于本容器，erase单位置不能end；insert可end；扩容全部失效，否则插入/删除处及其后失效。|vector<int> v{1,3}; v.insert(v.begin()+1,2); v.erase(v.begin()); show(v);|2 3
v.data(); v.capacity()|T*（const为const T*）；size_type容量|data不是新数组；只能访问size个有效对象；空容器不能解引用data；扩容后旧指针失效。|vector<int> v{4,7}; cout<<v.data()[1]<<" "<<(v.capacity()>=v.size())<<"\n";|7 1
s.find(part,pos); s.rfind(part,pos)|size_type：首个/最后匹配的下标；找不到为string::npos|先与npos比较再访问；空模式可匹配边界；pos是起查位置，不是出现次数。|string s="banana"; cout<<s.find("ana")<<" "<<s.rfind("ana")<<" "<<(s.find("x")==string::npos)<<"\n";|1 3 1
s.substr(pos,count)|string：复制至多count个字符；原串不改|第二参数是数量；pos==size返回空串，pos>size抛异常；复制k字符的时间和额外空间O(k)。|string s="planet"; cout<<s.substr(1,3)<<" "<<s.substr(s.size()).size()<<"\n";|lan 0
s.compare(other)|int：负、0、正，表示字典序小、等、大|不保证返回恰好-1或1；字符串字典序不是一般整数数值大小；不修改原串。|string s="apple"; cout<<(s.compare("pear")<0)<<" "<<(s.compare("apple")==0)<<"\n";|1 1
s.append(other); s += other; s += ch|string&：返回被修改的原字符串|在末尾追加，可能使旧迭代器、引用、c_str指针失效；不是数组越界写入。|string s="ab"; s.append("cd"); s+='!'; cout<<s<<"\n";|abcd!
s.insert(pos,text); s.erase(pos,count); s.replace(pos,count,text)|string&（本卡使用下标重载）|pos<=size；pos>size抛异常；count可截至末尾；修改后不要继续使用旧位置引用。|string s="abcd"; s.insert(2,"X"); s.erase(0,1); s.replace(1,2,"Q"); cout<<s<<"\n";|bQd
s.size(); s.length()|相同的size_type：字符单元数量|UTF-8中文可能占多个char，不是视觉字数；合法普通下标小于size。|string s="abc"; cout<<s.size()<<" "<<s.length()<<"\n";|3 3
s.c_str()|const char*：以空字符结尾的只读字符数据|指针由string管理，不手动delete；修改串或销毁串后不能继续依赖旧指针；内部可含空字符。|string s="cat"; const char* p=s.c_str(); cout<<p<<" "<<(p[s.size()]=='\0')<<"\n";|cat 1
getline(input,s); getline(input,s,delimiter)|istream&，可在if/while中检查流状态|读取并丢弃分隔符；不跳过开头空白；与>>混用时处理残留换行；失败看流状态。|istringstream in("one two\nthree\n"); string s; while(getline(in,s)) cout<<s<<"\n";|one two\nthree
pair<int,int> p(a,b); make_pair(a,b)|pair<T1,T2>；字段first、second|按first再second字典序比较；不是数组，不能p[0]；make_pair通常按值保存。|pair<int,int> p=make_pair(4,7); cout<<p.first<<" "<<p.second<<"\n";|4 7
make_tuple(a,b,c); get<I>(t)|tuple<...>；get返回对应元素引用（依值类别而变）|I是编译期常量；不能用运行时变量逐项get；引用元素寿命需另外保证。|tuple<int,string> t=make_tuple(4,string("hi")); get<0>(t)=8; cout<<get<0>(t)<<" "<<get<1>(t)<<"\n";|8 hi
tie(a,b)=p; tie(a,b)=t|由引用组成的tuple；赋值写回被绑定变量|a、b必须已存在且活着；不要返回绑定局部变量的tie；ignore可丢弃某项。|int a=0,b=0; tie(a,b)=make_pair(3,9); cout<<a<<" "<<b<<"\n";|3 9
sort(first,last); sort(first,last,comp)|void；原地按比较器排序，默认非降序|随机访问迭代器，左闭右开；比较器严格弱序，不用>=；不保证相等元素稳定。|vector<int> v{3,1,3,2}; sort(v.begin(),v.end()); show(v);|1 2 3 3
stable_sort(first,last,comp)|void；排序且保留等价元素原先相对顺序|随机访问迭代器；等价由比较器判断；不承诺额外空间O(1)。|vector<pair<int,int>> v{{2,0},{1,1},{2,2}}; stable_sort(v.begin(),v.end(),[](const pair<int,int>&a,const pair<int,int>&b){return a.first<b.first;}); for(const auto& p:v)cout<<p.second<<" "; cout<<"\n";|1 0 2 
min(a,b); max(a,b)|常用两参数重载返回const T&；赋给普通变量时复制值|a、b通常同类型；相等返回第一个；不要保存来自临时参数的返回引用；一次O(1)比较。|int a=4,b=9; int lo=min(a,b),hi=max(a,b); cout<<lo<<" "<<hi<<"\n";|4 9
min_element(first,last); max_element(first,last)|iterator：首个最小 / 首个最大元素位置|空区间返回last，不可解引用；不要求已排序；不会修改序列；扫描O(n)。|vector<int> v{3,1,1,7}; cout<<(min_element(v.begin(),v.end())-v.begin())<<" "<<*max_element(v.begin(),v.end())<<"\n";|1 7
unique(first,last); v.erase(newEnd,v.end())|unique返回逻辑新末尾；erase实际缩短vector|只合并相邻相等项，不自动排序；尾段内容不可当新结果；unique不改变容器size。|vector<int> v{1,1,2,2,3}; auto e=unique(v.begin(),v.end()); cout<<(e-v.begin())<<" "<<v.size()<<"\n"; v.erase(e,v.end()); show(v);|3 5\n1 2 3
lower_bound(first,last,x); upper_bound(first,last,x)|iterator：第一个>=x / 第一个>x的位置|本卡使用非降序序列和默认比较器；找不到返回last；位置不是元素值；随机访问O(log n)，一般前向迭代移动可线性。|vector<int> v{1,3,3,8}; cout<<(lower_bound(v.begin(),v.end(),3)-v.begin())<<" "<<(upper_bound(v.begin(),v.end(),3)-v.begin())<<"\n";|1 3
binary_search(first,last,x)|bool：是否存在与x等价的元素|按同一比较规则有序；不返回位置；随机访问序列对数比较，不修改原序列。|vector<int> v{1,3,8}; cout<<binary_search(v.begin(),v.end(),3)<<" "<<binary_search(v.begin(),v.end(),4)<<"\n";|1 0
equal_range(first,last,x)|pair<iterator,iterator>：等价元素的左闭右开区间|有序且比较规则一致；无匹配时first==second；区间长度仅随机访问迭代器可直接相减。|vector<int> v{1,3,3,8}; auto p=equal_range(v.begin(),v.end(),3); cout<<(p.first-v.begin())<<" "<<(p.second-v.begin())<<"\n";|1 3
find(first,last,x); find_if(first,last,pred)|iterator：首个匹配位置；无匹配为last|不要求排序；不能解引用last；pred不修改被检查元素；最坏线性。|vector<int> v{4,7,2}; cout<<*find(v.begin(),v.end(),7)<<" "<<*find_if(v.begin(),v.end(),[](int x){return x<3;})<<"\n";|7 2
count(first,last,x); count_if(first,last,pred)|iterator_traits<It>::difference_type：匹配数量|整个区间扫描；空区间返回0；不修改原序列；不能当成有序查询O(log n)。|vector<int> v{2,3,2,8}; cout<<count(v.begin(),v.end(),2)<<" "<<count_if(v.begin(),v.end(),[](int x){return x>2;})<<"\n";|2 2
copy(first,last,out); copy_if(first,last,out,pred)|OutputIt：写入完毕后的目标位置|目标必须有足够已存在元素，或用back_inserter追加；不在不合法重叠区间使用；源不修改。|vector<int> v{1,2,3},a(3),b; copy(v.begin(),v.end(),a.begin()); copy_if(v.begin(),v.end(),back_inserter(b),[](int x){return x%2;}); show(a); show(b);|1 2 3\n1 3
fill(first,last,x); fill_n(out,n,x)|fill返回void；fill_n返回写入后的迭代器|只修改已存在的目标元素；范围和容量必须合法；n是数量，不能写到未构造的reserve空间。|vector<int> v(4); fill(v.begin(),v.end(),7); fill_n(v.begin(),2,3); show(v);|3 3 7 7
all_of(first,last,pred); any_of(...); none_of(...)|bool：全部 / 至少一个 / 没有元素满足条件|空区间依次为true、false、true；允许提前结束；不修改原序列。|vector<int> v{2,4}; auto even=[](int x){return x%2==0;}; cout<<all_of(v.begin(),v.end(),even)<<" "<<any_of(v.begin(),v.end(),even)<<" "<<none_of(v.begin(),v.end(),even)<<"\n";|1 1 0
s.push(x); s.emplace(args...)|push为void；emplace在C++11为void，C++17起返回底层引用|stack是适配器；默认deque。构造参数必须适配元素；不提供下标和迭代器。|stack<pair<int,int>> s; s.push(make_pair(1,2)); s.emplace(3,4); cout<<s.top().first<<" "<<s.top().second<<"\n";|3 4
s.top()|T&；const stack返回const T&|必须非空；返回引用不是复制；弹出该元素后原引用不能继续用；读取O(1)。|stack<int> s; s.push(4); s.top()=9; cout<<s.top()<<"\n";|9
s.pop()|void；删除栈顶，不返回值|必须非空；要保留值先复制top；删除对象的引用失效。|stack<int> s; s.push(3); s.push(8); int x=s.top(); s.pop(); cout<<x<<" "<<s.top()<<"\n";|8 3
s.empty(); s.size()|bool；size_type|空栈也可调用；先empty再top/pop；默认底层常数时间。|stack<int> s; cout<<s.empty()<<" "<<s.size()<<"\n";|1 0
q.push(x); q.pop()|均void；push追加队尾，pop删除队首|pop前必须非空；不返回被删除的值；默认deque；先进先出。|queue<int> q; q.push(4); q.push(8); q.pop(); cout<<q.front()<<"\n";|8
q.front(); q.back()|T&：队首 / 队尾；const对象为const T&|两者都要求非空；pop删除队首引用，不能在删除后继续使用。|queue<int> q; q.push(4); q.push(8); cout<<q.front()<<" "<<q.back()<<"\n";|4 8
d.push_front(x); d.push_back(x)|void；在deque两端插入|两端插入使迭代器失效，但不使对已有元素的引用失效；不要套vector连续存储假设。|deque<int> d{4}; d.push_front(2); d.push_back(8); show(d);|2 4 8
d.pop_front(); d.pop_back()|void；删除deque对应端元素|必须非空；删除元素引用失效；边界迭代器规则随端点而异，删除后重新取得迭代器。|deque<int> d{2,4,8}; d.pop_front(); d.pop_back(); show(d);|4
d[i]; d.at(i)|T&；const对象为const T&|i<size；at越界抛异常，[]无检查；deque支持O(1)随机访问但整体不保证连续。|deque<int> d{2,4}; d[1]=9; cout<<d.at(1)<<"\n";|9
pq.top()|const T&：当前优先级最高元素|必须非空；不能通过top修改堆顶；默认less形成最大堆；读取O(1)。|priority_queue<int> q; q.push(4); q.push(9); cout<<q.top()<<"\n";|9
pq.push(x); pq.emplace(args...)|均void；插入后恢复堆序|比较器要严格弱序；底层vector扩容可能搬移全部元素，引用不要跨修改保存。|priority_queue<int> q; q.push(4); q.emplace(7); cout<<q.top()<<" "<<q.size()<<"\n";|7 2
pq.pop()|void；删除当前堆顶|必须非空；先top复制再pop；O(log n)比较，默认vector弹出尾项O(1)。|priority_queue<int> q; q.push(4); q.push(9); q.pop(); cout<<q.top()<<"\n";|4
priority_queue<int,vector<int>,greater<int>> q|类型声明：建立最小堆；greater<int>()比较返回bool|需要<queue>、<vector>、<functional>；比较方向与“谁先弹出”要区分。|priority_queue<int,vector<int>,greater<int>> q; q.push(8); q.push(3); cout<<q.top()<<"\n";|3
m.find(key); m.count(key)|map::iterator；size_type（map为0或1）|find未命中为end，不能解引用；查找不会插入；map查找O(log n)。|map<int,int> m{{2,8}}; cout<<(m.find(3)==m.end())<<" "<<m.count(2)<<" "<<m.size()<<"\n";|1 1 1
m[key]|mapped_type&；键不存在时插入值初始化的值|map<int,int>缺键默认0；查询也可能新增键；不希望插入时用find或at。|map<string,int> m; ++m["cat"]; cout<<m["cat"]<<" "<<m["dog"]<<" "<<m.size()<<"\n";|1 0 2
m.lower_bound(key); m.upper_bound(key)|iterator：按比较器首个不小于 / 大于key的键|成员函数O(log n)，不能用返回end的迭代器；不要用通用lower_bound在树迭代器上期待O(log n)移动。|map<int,int> m{{2,20},{5,50}}; cout<<m.lower_bound(3)->first<<" "<<m.upper_bound(2)->first<<"\n";|5 5
u.find(key)|unordered_map::iterator；未命中为end|平均O(1)，最坏O(n)；没有有序上下界；rehash使迭代器失效，但不使已有元素引用失效。|unordered_map<int,int> u{{2,8}}; cout<<(u.find(3)==u.end())<<" "<<u.find(2)->second<<"\n";|1 8
s.insert(x); s.emplace(args...)|set返回pair<iterator,bool>；multiset返回iterator|set去重，multiset允许重复；插入不使已有迭代器/引用失效；key不可通过迭代器修改。|set<int> s; auto a=s.insert(4); auto b=s.emplace(4); cout<<a.second<<" "<<b.second<<" "<<s.size()<<"\n";|1 0 1
s.find(key); s.lower_bound(key)|iterator：相等键 / 首个不小于键|未命中或无边界为end；有序树查询O(log n)，不能解引用end。|set<int> s{2,5}; cout<<(s.find(3)==s.end())<<" "<<*s.lower_bound(3)<<"\n";|1 5
s.erase(key); s.erase(it)|key重载返回删除数量；iterator重载返回下一个iterator|multiset.erase(key)删所有等价键，erase(it)只删一个；it必须可解引用；仅删掉的元素引用失效。|multiset<int> s{2,2,3}; s.erase(s.find(2)); cout<<s.count(2)<<" "<<s.erase(2)<<" "<<s.size()<<"\n";|1 1 1
a.fill(value); a.at(i)|fill返回void；at返回T&，const为const T&|array长度编译期固定；fill覆盖全部元素；at越界抛异常；array<T,0>不能访问元素。|array<int,3> a{}; a.fill(4); a.at(1)=8; show(a);|4 8 4
lst.splice(pos,other); lst.splice(pos,other,it)|void；把节点转移至pos之前|两list分配器必须相等；迭代器仍指向原元素但元素已属目标容器；不同重载复杂度不同。|list<int> a{1,4},b{2,3}; a.splice(next(a.begin()),b); show(a); cout<<b.empty()<<"\n";|1 2 3 4\n1
lst.sort(); lst.unique()|C++11中均void；成员排序、删除相邻重复|list不支持std::sort所需随机访问；sort稳定O(n log n)，unique线性；只有相邻重复才合并。|list<int> a{3,1,1,2}; a.sort(); a.unique(); show(a);|1 2 3
f.before_begin()|iterator：首元素之前的位置|这是插入/删除首元素所需位置，不指向元素，不可解引用；空表before_begin也合法。|forward_list<int> f{2}; f.insert_after(f.before_begin(),1); show(f);|1 2
f.insert_after(pos,x); f.erase_after(pos)|iterator：插入元素 / 删除元素之后的位置|insert_after不能end；erase_after要求pos后存在元素；仅被删除元素的迭代器和引用失效。|forward_list<int> f{1,3}; auto p=f.insert_after(f.begin(),2); f.erase_after(p); show(f);|1 2
next_permutation(first,last); prev_permutation(first,last)|bool：是否得到下一个/上一个字典序排列|双向迭代器；到末尾返回false并回到反向极值排列；要枚举全部不同排列需先按对应方向排序。|vector<int> v{1,2,3}; cout<<next_permutation(v.begin(),v.end())<<"\n"; show(v); prev_permutation(v.begin(),v.end()); show(v);|1\n1 3 2\n1 2 3
partial_sort(first,middle,last)|void；最小的k=middle-first项已排序放前面|随机访问，first<=middle<=last；后半部分未排序；一般O(n log k)比较，k=0为空前缀。|vector<int> v{5,1,4,2,3}; partial_sort(v.begin(),v.begin()+2,v.end()); cout<<v[0]<<" "<<v[1]<<"\n";|1 2
nth_element(first,nth,last)|void；nth为完整排序后对应值，两侧满足分割关系|随机访问，nth可last；两侧内部没有排序保证；通常写平均O(n)；不能拿它当完整sort。|vector<int> v{5,1,4,2,3}; nth_element(v.begin(),v.begin()+2,v.end()); cout<<v[2]<<"\n";|3
b.set(); b.set(pos,value); b.reset(); b.reset(pos); b.flip(); b.flip(pos)|bitset<N>&：返回修改后的自身|pos<N；pos版本越界抛out_of_range；整数位0是最低位；to_string最左是最高位。|bitset<4> b; b.set(1); b.flip(0); b.reset(1); cout<<b<<"\n";|0001
b.test(pos); b[pos]|test返回bool；非const []返回代理引用，const []返回bool|pos<N；test越界抛异常；[]不提供同样检查；代理引用不等同bool&。|bitset<4> b; b[2]=true; cout<<b.test(2)<<" "<<b[0]<<"\n";|1 0
b.count(); b.any(); b.all(); b.none()|size_t：1的个数；其余为bool|不会修改位；bitset<0>.all/none为true、any为false；复杂度与N/实现字长相关，不保证所有N下O(1)。|bitset<4> b(string("0101")); cout<<b.count()<<" "<<b.any()<<" "<<b.all()<<" "<<b.none()<<"\n";|2 1 0 0
b.to_string(); b.to_ullong()|string；unsigned long long|字符串从高位到低位；若数值无法放入unsigned long long，to_ullong抛overflow_error；N大不一定溢出，取决于置位位置。|bitset<4> b(9); cout<<b.to_string()<<" "<<b.to_ullong()<<"\n";|1001 9
'''
rows=[line.split('|') for line in raw.strip().splitlines()]
assert len(rows)==65,len(rows)
def prefix_for(body):
    headers=['iostream']
    tokens={'vector':'vector','string':'string','istringstream':'sstream','pair':'utility','make_pair':'utility','tuple':'tuple','make_tuple':'tuple','get':'tuple','tie':'tuple','stack':'stack','queue':'queue','deque':'deque','priority_queue':'queue','greater':'functional','map':'map','unordered_map':'unordered_map','set':'set','multiset':'set','array':'array','list':'list','forward_list':'forward_list','bitset':'bitset','out_of_range':'stdexcept','back_inserter':'iterator','next':'iterator'}
    for token,header in tokens.items():
        if re.search(r'\b'+token+r'\b',body) and header not in headers:headers.append(header)
    if re.search(r'\b(sort|stable_sort|min|max|min_element|max_element|unique|lower_bound|upper_bound|binary_search|equal_range|find|find_if|count|count_if|copy|copy_if|fill|fill_n|all_of|any_of|none_of|next_permutation|prev_permutation|partial_sort|nth_element)\s*\(',body):headers.append('algorithm')
    code='\n'.join('#include <'+h+'>' for h in headers)+'\nusing namespace std;\n'
    if 'show(' in body:
        typ=re.search(r'(vector<int>|deque<int>|list<int>|forward_list<int>|array<int,3>)',body).group(1)
        code+='void show(const '+typ+'& c){\n    bool first=true;\n    for(int x:c){ // C++11：依次读取每个元素\n        if(!first)cout<<" "; first=false; cout<<x;\n    }\n    cout<<"\\n";\n}\n'
    return code
programs=[]
for item,fields in zip(r['items'],rows):
 sig,returns,boundary,body,expected=fields
 item.update(signature=sig,returns=returns,boundary=boundary,exampleCode=prefix_for(body)+'int main(){\n'+body+'\n}\n',exampleOutput=expected.replace('\\n','\n')+'\n',exampleScope='本接口组的独立教学例；不是正式题解',exercise='先预测输出，再改变一个输入值或合法边界并运行核对；不增加完整题目。')
 programs.append((item['id'],item['exampleCode'],'c++11',item['exampleOutput']))
# Extension cards have complete contracts from v1.2. Add and verify the contextual program in place.
byid={d['id']:d for d in seed['docs']+r['docs']}
for item in r['items'][65:]:
 doc=byid[item['guideId']];code=re.findall(r'```cpp\n(.*?)```',doc['body'],re.S)[0]
 item.update(exampleCode=code,exampleScope='本模块的组合教学例，包含关联操作；先在代码中查找当前函数名',exercise='预测本模块输出，再只改变当前接口的参数或数据，解释前后状态。')
 programs.append((item['id'],code,'c++17' if item['version']=='C++17' else 'c++11',None))
# Compile distinct programs once. Examples with expected output must match exactly.
cache={}
with tempfile.TemporaryDirectory() as tmp:
 for ident,code,std,expected in programs:
  k=(code,std)
  if k not in cache:
   src=Path(tmp)/'demo.cpp';exe=Path(tmp)/'demo';src.write_text(code)
   p=subprocess.run(['g++','-std='+std,'-Wall','-Wextra','-pedantic',str(src),'-o',str(exe)],capture_output=True,text=True)
   if p.returncode:raise RuntimeError(ident+'\n'+p.stderr)
   out=subprocess.run([str(exe)],capture_output=True,text=True,check=True,timeout=3).stdout
   cache[k]=out
  if expected is not None:assert cache[k]==expected,(ident,repr(cache[k]),repr(expected))
  item=next(i for i in r['items'] if i['id']==ident);item['exampleOutput']=cache[k];item['exampleVerifiedAt']='2026-10-24';item['sources']=['https://eel.is/c++draft/algorithms' if item['category'] not in ['vector','string'] else 'https://eel.is/c++draft/'+('vector' if item['category']=='vector' else 'basic.string')]
r['verifiedAt']='2026-10-24';r['exampleProgramCount']=len(cache)
(root/'content/stl-reference.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(f'110 API cards; {len(cache)} distinct programs compiled and executed; 65 exact expected-output checks passed')
